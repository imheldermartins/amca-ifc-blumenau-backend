/** Review the actual PDF from memory. Only PNG review images are written. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { PagePdfService, renderPdfBuffer } from '@/services/pages/page-pdf-service';
import { childColumn, CHILD_TITLE, defaultRecursiveConfig, recursiveTable, pdfColumn, recursiveToken, type RecursiveRow } from '@/services/pages/recursive-template';
import type { PageExportStore } from '@/repositories/page-export-repository';
import type { MentionStore } from '@/repositories/mention-repository';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const fields = [...defaultRecursiveConfig().fields, { id: 'total', label: 'Valor', text: `R$ ${recursiveToken(childColumn('total'))}` }];
const table = recursiveTable({ ...defaultRecursiveConfig(), relationColumnId: 'relation', fields });
table.rows.push({ id: 'total', mode: 'static', cells: [{ id: 'total-value', column: 0, colSpan: 2, rowSpan: 1, header: false, text: `Total da página: R$ ${recursiveToken(pdfColumn('total'))}` }] });
const rows: RecursiveRow[] = Array.from({ length: 8 }, (_, index) => ({ id: `sample-${index}`, title: `Entrega ${index + 1}`, values: { total: `${index + 1}25,00` }, dates: { date: index < 7 ? `2026-03-${String(index + 11).padStart(2, '0')}T00:00:00.000Z` : '2028-08-20T00:00:00.000Z' } }));
const block = (kind: string, content: unknown[], extra = {}) => ({ type: 'editableBlock', attrs: { kind, ...extra }, content });
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const document = { type: 'doc', content: [{ type: 'blockRow', content: [{ type: 'blockColumn', attrs: { span: 100 }, content: [
  block('richText', [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Documento com formatação e menções' }] }, paragraph('Conteúdo em português: ação, calendário e relatório. Somente título e blocos.'), { type: 'paragraph', content: [{ type: 'text', text: 'Página selecionada: ' }, { type: 'mention', attrs: { id: CHILD_TITLE } }] }]),
  block('richText', [{ type: 'paragraph', content: ['purple', 'blue', 'green', 'red'].map((name) => ({ type: 'text', text: `${name} `, marks: [{ type: 'textStyle', attrs: { color: `var(--p-${name})` } }] })) }, { type: 'paragraph', content: [{ type: 'text', text: 'Destaque verde', marks: [{ type: 'highlight', attrs: { color: 'color-mix(in oklab, var(--p-green) 28%, transparent)' } }] }, { type: 'text', text: ' · Fórmula inline: ' }, { type: 'inlineMath', attrs: { latex: 'x^2 + y^2' }, marks: [{ type: 'textStyle', attrs: { color: 'var(--p-blue)' } }] }] }]),
  block('checkList', [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('Item concluído')] }, { type: 'taskItem', attrs: { checked: false }, content: [paragraph('Item pendente')] }] }]),
  block('mathBlock', [{ type: 'blockMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } }]),
  block('codeBlock', [{ type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: 'const arquivo = await gerarPDF(dados);\n// buffer temporário' }] }]),
  block('tableRecursive', [{ type: 'paragraph' }], { recursive: { version: 1, relationColumnId: 'relation', fields, dateColumnId: null, table } }),
  block('calendarRecursive', [{ type: 'paragraph' }], { recursive: { version: 1, relationColumnId: 'relation', fields, dateColumnId: 'date' } }),
] }] }] };
const data = { page: async (id: string) => ({ id, title: 'Relatório de entregas' }), parent: async () => 'parent', document: async () => ({ content: document }), row: async () => rows[0], columns: async () => [], calculated: async () => {}, relationRows: async () => structuredClone(rows) } as unknown as PageExportStore;
const service = new PagePdfService(data, { resolve: async () => ({}) } as unknown as MentionStore);
const built = await service.html('sample-0', 'actor', 'parent');
// Inspect browser-computed print styles in the same offline HTML used by the PDF.
const browser = await puppeteer.launch({ headless: true,
  ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  args: ['--disable-dev-shm-usage', ...(process.env.PDF_CHROMIUM_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [])],
});
try {
  const page = await browser.newPage();
  await page.setContent(built.html, { waitUntil: 'load' });
  const styles = await page.evaluate(async () => {
    await document.fonts.ready;
    const cell = getComputedStyle(document.querySelector('.recursive-table td')!);
    const checked = getComputedStyle(document.querySelector('.task-item[data-checked="true"]>.task-check')!);
    return { padding: [cell.paddingTop, cell.paddingRight, cell.paddingBottom, cell.paddingLeft], lineHeight: cell.lineHeight,
      colors: ['purple', 'blue', 'green', 'red'].map((name) => getComputedStyle([...document.querySelectorAll('span')].find((span) => span.textContent === `${name} `)!).color),
      highlight: getComputedStyle(document.querySelector('mark')!).backgroundColor,
      circle: checked.borderRadius, checked: checked.backgroundColor,
      tick: getComputedStyle(document.querySelector('.task-item[data-checked="true"]>.task-check')!, '::after').content,
      math: document.querySelectorAll('.math-block .katex,.math-inline .katex').length,
      mathErrors: document.querySelectorAll('.katex-error').length, mathFont: document.fonts.check('14px KaTeX_Main'),
      code: document.querySelector('pre code .hljs-keyword')?.textContent,
    };
  });
  assert.deepEqual(styles.padding, ['5px', '8px', '5px', '8px']);
  assert.deepEqual(styles.colors, ['rgb(129, 80, 189)', 'rgb(52, 128, 204)', 'rgb(39, 148, 100)', 'rgb(209, 66, 98)']);
  assert.notEqual(styles.highlight, 'rgba(0, 0, 0, 0)');
  assert.equal(styles.circle, '50%'); assert.equal(styles.checked, 'rgb(129, 80, 189)'); assert.equal(styles.tick, '""');
  assert.equal(styles.math, 2); assert.equal(styles.mathErrors, 0); assert.equal(styles.mathFont, true); assert.equal(styles.code, 'const');
  console.log('Verified print styles:', JSON.stringify(styles));
} finally { await browser.close(); }
const buffer = await renderPdfBuffer(built.html);
try {
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const pdf = await task.promise;
  const directory = await mkdtemp(join(tmpdir(), 'cubs-pdf-review-'));
  const text: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise;
    const path = join(directory, `page-${pageNumber}.png`);
    await writeFile(path, canvas.toBuffer('image/png'));
    const content = await page.getTextContent();
    text.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    console.log(path);
  }
  if (!text.join(' ').toLocaleLowerCase().includes('agosto de 2028')) throw new Error('Calendário incompleto no PDF');
  if (text.join(' ').includes('@{')) throw new Error('Menção não resolvida');
  if (!text.join(' ').includes('Total da página: R$ 125,00')) throw new Error('Total fixo da página ausente');
  if (!text.join(' ').includes('Relatório de entregas')) throw new Error('Título padrão ausente');
  const hidden = await service.generate('sample-0', 'actor', 'parent', undefined, { includePageTitle: false });
  const hiddenTask = pdfjs.getDocument({ data: new Uint8Array(hidden.buffer), useSystemFonts: true });
  try {
    const hiddenPdf = await hiddenTask.promise;
    const hiddenText: string[] = [];
    for (let index = 1; index <= hiddenPdf.numPages; index++) {
      const content = await (await hiddenPdf.getPage(index)).getTextContent();
      hiddenText.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    if (hiddenText.join(' ').includes('Relatório de entregas')) throw new Error('Título automático continua no PDF com a opção desligada');
    if (!hiddenText.join(' ').includes('Entrega 1')) throw new Error('Desligar o título removeu a menção da página');
  } finally { await hiddenTask.destroy(); hidden.buffer.fill(0); }
  console.log('Verified real PDFs with and without the automatic page title.');
  console.log(`Verified ${pdf.numPages} pages, ${buffer.length} bytes, PDF remained in memory.`);
  await task.destroy();
} finally { buffer.fill(0); }
