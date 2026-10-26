import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { zipSync } from 'fflate';
import store, { PageExportStore } from '@/repositories/page-export-repository';
import mentions, { MentionStore } from '@/repositories/mention-repository';
import { decodePageDocument, type DocumentNode } from './page-document-codec.js';
import { pageExportBody, pageExportHtml } from './page-export-html.js';
import { PDF_TITLE, readRecursiveConfig, recursiveText, type RecursiveRow } from './recursive-template.js';
import { mentionIds, parseMentionId } from '@/services/mentions/template';
import { slugify } from '@/utils/slugify';

export class PagePdfError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface PagePdfOptions { includePageTitle?: boolean }
export function pdfFilename(title: string, now = new Date()): string {
  const name = slugify(title.replaceAll('_', ' ')).slice(0, 140);
  return `${name || `cubspage_${now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)}`}.pdf`;
}
const require = createRequire(import.meta.url);
let assetPromise: Promise<string> | undefined;
async function fontAssets(): Promise<string> {
  return assetPromise ??= (async () => {
    const cssPath = require.resolve('katex/dist/katex.min.css');
    let css = await readFile(cssPath, 'utf8');
    const matches = [...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)];
    for (const match of matches) {
      const bytes = await readFile(resolve(dirname(cssPath), match[1]!), null);
      css = css.replaceAll(match[0], `url(data:font/woff2;base64,${bytes.toString('base64')})`);
    }
    // Only embedded WOFF2 is needed; block fallback file/URL references.
    const font = await readFile(require.resolve('@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2'));
    return `@font-face{font-family:'Noto Sans';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2')}` + css.replace(/url\((?!data:)[^)]+\)/g, 'url(data:,)');
  })();
}
/** A Chromium context owns no PDF path. Always close it, including on abort/failure. */
export async function renderPdfBuffer(html: string, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) throw new PagePdfError(499, 'Exportação cancelada');
  const browser = await puppeteer.launch({ headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ['--disable-dev-shm-usage', ...(process.env.PDF_CHROMIUM_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [])],
  });
  const abort = () => { void browser.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new PagePdfError(499, 'Exportação cancelada');
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => { void (/^(data:|about:)/.test(request.url()) ? request.continue() : request.abort()); });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    const bytes = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: 30_000 });
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    signal?.removeEventListener('abort', abort);
    await browser.close();
  }
}
export class PagePdfService {
  private active = 0;
  public constructor(private readonly data: PageExportStore = store, private readonly refs: MentionStore = mentions,
    private readonly render = renderPdfBuffer) {}
  public async catalog(pageId: string, actor: string) {
    if (!await this.data.page(pageId, actor)) throw new PagePdfError(403, 'Página indisponível');
    return this.data.catalog(pageId, actor);
  }
  public async html(pageId: string, actor: string, templatePageId?: string, options: PagePdfOptions = {}, prepared?: { document: DocumentNode }): Promise<{ html: string; filename: string }> {
    const page = await this.data.page(pageId, actor);
    if (!page) throw new PagePdfError(403, 'Página indisponível');
    const sourceId = templatePageId ?? pageId;
    if (templatePageId && (await this.data.parent(pageId) !== templatePageId || !await this.data.page(templatePageId, actor))) {
      throw new PagePdfError(403, 'Template indisponível para esta página');
    }
    const saved = prepared ? null : await this.data.document(sourceId);
    const document = prepared?.document ?? (saved ? decodePageDocument(saved.content) : { type: 'doc', content: [] });
    const parentId = templatePageId ?? await this.data.parent(pageId);
    const columns = parentId ? await this.data.columns(parentId) : [];
    const contextRow = parentId ? await this.data.row(page, columns, actor) : { id: pageId, title: page.title ?? '', values: {}, dates: {} };
    if (parentId) await this.data.calculated([contextRow], columns, parentId, actor);
    const serialized = JSON.stringify(document);
    const relationRows: Record<string, RecursiveRow[]> = Object.create(null);
    const nodeMentions: string[] = [];
    const visit = async (node: DocumentNode): Promise<void> => {
      if (node.type === 'mention') nodeMentions.push(`@{${String(node.attrs?.id ?? '')}}`);
      if (node.type === 'editableBlock' && ['tableRecursive', 'calendarRecursive'].includes(String(node.attrs?.kind))) {
        const config = readRecursiveConfig(node.attrs?.recursive);
        if (!config.relationColumnId) throw new PagePdfError(400, 'Selecione uma propriedade Relation no bloco recursivo');
        if (!relationRows[config.relationColumnId]) {
          const related = await this.data.relationRows(pageId, config.relationColumnId, actor);
          if (!related) throw new PagePdfError(400, 'Relation indisponível para esta página');
          relationRows[config.relationColumnId] = related;
        }
      }
      for (const child of node.content ?? []) await visit(child);
    };
    await visit(document);
    const rows = Object.values(relationRows).flat();
    const texts = [serialized, ...nodeMentions, page.title ?? '', ...rows.flatMap((row) => [row.title, ...Object.values(row.values)]), ...Object.values(contextRow.values)];
    const ids = [...new Set(texts.flatMap(mentionIds))];
    const values: Record<string, string | null> = {};
    for (let i = 0; i < ids.length; i += 100) Object.assign(values, await this.refs.resolve(actor, { pageId }, ids.slice(i, i + 100)));
    // Mentions inserted in the parent's template address the row being exported.
    if (templatePageId) for (const id of ids) {
      const ref = parseMentionId(id);
      if (ref?.kind === 'pages' && ref.entityId === templatePageId) {
        if (ref.field === 'title') values[id] = contextRow.title;
        else if (ref.field.startsWith('columns.')) values[id] = contextRow.values[ref.field.slice(8)] ?? '';
      }
    }
    const fixed = (text: string) => text.replace(/@\{([^{}]{1,1600})\}/g, (_token, id: string) => values[id] ?? '');
    const resolveId = (id: string) => id === PDF_TITLE ? fixed(contextRow.title) : id.startsWith('pdf:page:columns.') ? fixed(contextRow.values[id.slice('pdf:page:columns.'.length)] ?? '') : values[id] ?? '';
    const resolveText = (text: string) => fixed(recursiveText(text, contextRow, resolveId))
      .replace(/@page\.title\b/g, () => fixed(contextRow.title))
      .replace(/@columns\.([0-9A-Za-z_-]+)/g, (_token, id: string) => fixed(contextRow.values[id] ?? ''));
    for (const row of rows) { row.title = fixed(row.title); for (const key of Object.keys(row.values)) row.values[key] = fixed(row.values[key]!); }
    const body = pageExportBody(document, { title: fixed(page.title ?? ''), relationRows, resolve: resolveText, includePageTitle: options.includePageTitle !== false });
    return { html: pageExportHtml(body, await fontAssets()), filename: pdfFilename(fixed(page.title ?? '')) };
  }
  public async generate(pageId: string, actor: string, templatePageId?: string, signal?: AbortSignal, options: PagePdfOptions = {}, prepared?: { document: DocumentNode }) {
    if (this.active >= 2) throw new PagePdfError(429, 'Há outras exportações em andamento. Tente novamente.');
    this.active++;
    try {
      const document = await this.html(pageId, actor, templatePageId, options, prepared);
      if (Buffer.byteLength(document.html, 'utf8') > 32 * 1024 * 1024) throw new PagePdfError(413, 'Conteúdo excede 32 MB. Reduza a quantidade de páginas ou propriedades.');
      const buffer = await this.render(document.html, signal);
      if (buffer.length > 20 * 1024 * 1024) { buffer.fill(0); throw new PagePdfError(413, 'PDF excede 20 MB'); }
      return { buffer, filename: document.filename, contentType: 'application/pdf' };
    } finally { this.active--; }
  }
  public async batch(parentId: string, actor: string, childIds: string[], signal?: AbortSignal, options: PagePdfOptions = {}) {
    const catalog = await this.catalog(parentId, actor);
    if (!childIds.length || childIds.length > 50 || new Set(childIds).size !== childIds.length || childIds.some((id) => !catalog.children.some((child) => child.id === id))) {
      throw new PagePdfError(400, 'Selecione de 1 a 50 filhas diretas acessíveis');
    }
    if (childIds.length === 1) return this.generate(childIds[0]!, actor, parentId, signal, options);
    const saved = await this.data.document(parentId);
    const document = saved ? decodePageDocument(saved.content) : { type: 'doc', content: [] };
    const prepared = { document };
    const files: Record<string, Uint8Array> = {}, buffers: Buffer[] = [];
    let size = 0;
    try {
      for (const [index, childId] of childIds.entries()) {
        const pdf = await this.generate(childId, actor, parentId, signal, options, prepared);
        buffers.push(pdf.buffer); size += pdf.buffer.length;
        if (size > 64 * 1024 * 1024) throw new PagePdfError(413, 'O lote excede 64 MB. Selecione menos páginas.');
        let name = pdf.filename, suffix = index + 1;
        while (files[name]) name = `${pdf.filename.slice(0, -4)}-${suffix++}.pdf`;
        files[name] = pdf.buffer;
      }
      const zipped = zipSync(files, { level: 0 });
      return { buffer: Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength), filename: 'cubspages.zip', contentType: 'application/zip' };
    } finally { for (const buffer of buffers) buffer.fill(0); }
  }
}
export default new PagePdfService();
