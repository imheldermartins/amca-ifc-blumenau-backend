import { describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { PagePdfService, pdfFilename, renderPdfBuffer } from './page-pdf-service.js';
import { pageExportBody, pageExportHtml } from './page-export-html.js';
import { childColumn, CHILD_TITLE, defaultRecursiveConfig, recursiveMonths, recursiveTableHtml, recursiveToken, type RecursiveRow } from './recursive-template.js';
import { decodePageDocument, encodePageDocument } from './page-document-codec.js';
import type { PageExportStore } from '@/repositories/page-export-repository';
import type { MentionStore } from '@/repositories/mention-repository';

const rows: RecursiveRow[] = [
  { id: 'one', title: 'Uma <filha>', values: { value: '125', note: '' }, dates: { date: '2026-03-31T00:00:00.000Z@2026-04-02T00:00:00.000Z' } },
  { id: 'two', title: 'Outra filha', values: { value: '250' }, dates: { date: '2028-08-20T00:00:00.000Z' } },
  { id: 'three', title: 'Sem data', values: {}, dates: {} },
];
const config = { ...defaultRecursiveConfig(), relationColumnId: 'relation', dateColumnId: 'date', fields: [
  ...defaultRecursiveConfig().fields,
  { id: 'value', label: 'Total', text: `${recursiveToken(CHILD_TITLE)}: R$ ${recursiveToken(childColumn('value'))}` },
] };
const document = { type: 'doc', content: [{ type: 'blockRow', content: [{ type: 'blockColumn', attrs: { span: 100 }, content: [
  { type: 'editableBlock', attrs: { kind: 'richText' }, content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: CHILD_TITLE } }] }] },
  { type: 'editableBlock', attrs: { kind: 'tableRecursive', recursive: config }, content: [{ type: 'paragraph' }] },
  { type: 'editableBlock', attrs: { kind: 'calendarRecursive', recursive: config }, content: [{ type: 'paragraph' }] },
] }] }] };
function setup() {
  const data = {
    page: vi.fn(async (id: string) => id === 'denied' ? null : ({ id, title: 'Minha_Página' })),
    parent: vi.fn(async () => 'parent'), document: vi.fn(async (_id: string) => ({ content: encodePageDocument(document) })),
    columns: vi.fn(async () => []), row: vi.fn(async () => ({ ...rows[0]!, title: 'Uma filha' })), calculated: vi.fn(async () => {}),
    rows: vi.fn(async () => structuredClone(rows)), catalog: vi.fn(async () => ({ children: rows.map((row) => ({ id: row.id, title: row.title })), columns: [] })),
    relationRows: vi.fn(async (_pageId: string, _columnId: string): Promise<RecursiveRow[] | null> => structuredClone(rows)),
  };
  const render = vi.fn(async (_html: string, _signal?: AbortSignal) => Buffer.from('%PDF-1.4\nexample'));
  const refs = { resolve: vi.fn(async () => ({})) };
  return { data, render, refs, service: new PagePdfService(data as unknown as PageExportStore, refs as unknown as MentionStore, render) };
}
describe('Recursive PDF', () => {
  it('exports the current document directly and never loads the parent template implicitly', async () => {
    const { service, data } = setup();
    data.document.mockImplementation(async (id: string) => ({ content: encodePageDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id === 'parent' ? 'Documento do pai' : 'Documento atual' }] }] }) }));
    const result = await service.html('one', 'actor');
    expect(data.document).toHaveBeenCalledWith('one');
    expect(result.html).toContain('Documento atual');
    expect(result.html).not.toContain('Documento do pai');
  });
  it('projects each selected row relation separately, including one, many and empty relations', async () => {
    const { service, data, render } = setup();
    data.relationRows.mockImplementation(async (id) => id === 'one' ? [rows[0]!] : [rows[1]!, rows[2]!]);
    await service.batch('parent', 'actor', ['one', 'two']);
    expect(render.mock.calls[0]![0]).toContain('Uma &lt;filha&gt;');
    expect(render.mock.calls[0]![0]).not.toContain('Outra filha');
    expect(render.mock.calls[1]![0]).toContain('Outra filha');
    expect(render.mock.calls[1]![0]).not.toContain('Uma &lt;filha&gt;');
    expect(data.rows).not.toHaveBeenCalled();
    expect(data.relationRows).toHaveBeenCalledTimes(2);
    data.relationRows.mockResolvedValue([]);
    expect((await service.html('one', 'actor', 'parent')).html).not.toContain('<article>');
    data.relationRows.mockResolvedValue(null);
    await expect(service.html('one', 'actor', 'parent')).rejects.toThrow('Relation indisponível');
  });
  it('rejects a legacy recursive block without an explicit Relation', async () => {
    const { service, data } = setup();
    data.document.mockResolvedValueOnce({ content: encodePageDocument({ type: 'doc', content: [{ type: 'editableBlock', attrs: { kind: 'tableRecursive', recursive: defaultRecursiveConfig() } }] }) });
    await expect(service.html('one', 'actor')).rejects.toThrow('Selecione uma propriedade Relation');
  });
  it('binds the parent template page.title mention to each exported row', async () => {
    const { service, data, refs } = setup();
    const parent = '01K89WJ7X00000000000000012';
    const id = `pages:${parent}:title`;
    data.parent.mockResolvedValue(parent);
    data.document.mockResolvedValue({ content: encodePageDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id } }] }] }) });
    refs.resolve.mockResolvedValue({ [id]: 'Título do pai' });
    const built = await service.html('one', 'actor', parent, { includePageTitle: false });
    expect(built.html).toContain('<span class="mention">Uma filha</span>');
    expect(built.html).not.toContain('Título do pai');
    expect(built.html).not.toContain('<h1 class="page-title">');
  });
  it('can omit the automatic page title while preserving content, mentions and the filename', async () => {
    const { service } = setup();
    const shown = await service.html('one', 'actor', 'parent');
    const hidden = await service.html('one', 'actor', 'parent', { includePageTitle: false });
    expect(shown.html).toContain('<h1 class="page-title">Minha_Página</h1>');
    expect(hidden.html).not.toContain('<h1 class="page-title">');
    expect(hidden.html).toContain('<span class="mention">Uma filha</span>');
    expect(hidden.html).toContain('recursive-table');
    expect(hidden.filename).toBe(shown.filename);
    const heading = pageExportBody({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título escrito no documento' }] }] }, { title: 'Página', rows: [], resolve: (text) => text, includePageTitle: false });
    expect(heading).toBe('<h1>Título escrito no documento</h1>');
  });
  it.each([true, false])('applies the page title option to every PDF in a ZIP: %s', async (includePageTitle) => {
    const { service, render } = setup();
    const result = await service.batch('parent', 'actor', ['one', 'two'], undefined, { includePageTitle });
    expect(render).toHaveBeenCalledTimes(2);
    for (const [html] of render.mock.calls) expect(html.includes('<h1 class="page-title">')).toBe(includePageTitle);
    result.buffer.fill(0);
  });
  it('round-trips both block configurations without values in the compact document', () => {
    expect(decodePageDocument(encodePageDocument(document))).toEqual(document);
    expect(JSON.stringify(encodePageDocument(document))).not.toContain('125');
  });
  it('substitutes multiple row references, escapes HTML, and keeps empty cells', () => {
    const html = recursiveTableHtml(config, rows);
    expect(html).toContain('Uma &lt;filha&gt;: R$ 125');
    expect(html).toContain('Outra filha: R$ 250');
    expect(html).not.toContain('@{');
  });
  it('renders only occupied months, includes range days and skips missing/invalid dates', () => {
    const months = recursiveMonths(config, [...rows, { ...rows[0]!, dates: { date: '2027-02-30T00:00:00.000Z' } }]);
    expect(months.map((month) => month.key)).toEqual(['2026-03', '2026-04', '2028-08']);
    expect(months[1]!.days[0]!.rows).toHaveLength(1);
    expect(months[1]!.days[1]!.rows).toHaveLength(1);
    expect(months[1]!.days[2]!.rows).toHaveLength(0);
  });
  it('never hides cards behind a +N overflow', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...rows[1]!, id: String(i), title: `Card ${i}` }));
    const html = pageExportBody(document, { title: 'Título', relationRows: { relation: many }, resolve: (text) => text });
    expect(html.match(/<article>/g)).toHaveLength(30);
    expect(html).toContain('Card 29');
    expect(html).not.toContain('overflow-y');
  });
  it('uses the parent template for each selected child and wipes intermediate PDF buffers', async () => {
    const { service, render } = setup();
    const result = await service.batch('parent', 'actor', ['one', 'two']);
    expect(result.contentType).toBe('application/zip');
    const files = unzipSync(result.buffer);
    expect(Object.keys(files)).toEqual(['minha-pagina.pdf', 'minha-pagina-2.pdf']);
    expect(new TextDecoder().decode(Object.values(files)[0])).toContain('%PDF');
    for (const returned of render.mock.results) expect((await returned.value).every((byte: number) => byte === 0)).toBe(true);
  });
  it('downloads one child as PDF and rejects cross-parent or inaccessible templates atomically', async () => {
    const { service, render } = setup();
    expect((await service.batch('parent', 'actor', ['one'])).contentType).toBe('application/pdf');
    render.mockClear();
    await expect(service.batch('parent', 'actor', ['one', 'foreign'])).rejects.toThrow();
    await expect(service.generate('one', 'actor', 'foreign')).rejects.toThrow('Template indisponível');
    await expect(service.generate('denied', 'actor')).rejects.toThrow('Página indisponível');
    expect(render).not.toHaveBeenCalled();
  });
  it('generates in-memory PDF with real Chromium and resolves child variables', async () => {
    const { service } = setup();
    const built = await service.html('one', 'actor', 'parent');
    expect(built.html).toContain('Uma filha');
    expect(built.html).not.toContain('@{recursive');
    const buffer = await renderPdfBuffer(built.html);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
    buffer.fill(0);
  }, 30_000);
  it('resolves persisted mention nodes, which store an ID without the text-token wrapper', async () => {
    const { service, data, refs } = setup();
    const id = 'pages:01K89WJ7X00000000000000012:title';
    data.document.mockResolvedValueOnce({ content: encodePageDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id } }] }] }) });
    refs.resolve.mockResolvedValueOnce({ [id]: 'Título resolvido' });
    expect((await service.html('one', 'actor')).html).toContain('Título resolvido');
  });
  it('sanitizes unsafe links, remote images and arbitrary text; preserves math and marks', () => {
    const html = pageExportBody({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      { type: 'imageBlock', attrs: { src: 'http://127.0.0.1/secret' } },
      { type: 'blockMath', attrs: { latex: 'x^2' } },
    ] }, { title: 'Seguro', rows: [], resolve: (text) => text });
    expect(html).toContain('<strong>&lt;script&gt;'); expect(html).toContain('katex');
    expect(html).not.toContain('javascript:'); expect(html).not.toContain('127.0.0.1');
    expect(pageExportHtml(html)).toContain("default-src 'none'");
  });
  it('exports the editor color tokens and highlights through the compact codec, including inline math and mentions', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Roxo', marks: [{ type: 'textStyle', attrs: { color: 'var(--p-purple)' } }, { type: 'bold' }] },
      { type: 'text', text: 'Marca', marks: [{ type: 'highlight', attrs: { color: 'color-mix(in oklab, var(--p-green) 28%, transparent)' } }] },
      { type: 'mention', attrs: { id: 'test' }, marks: [{ type: 'textStyle', attrs: { color: 'var(--p-red)' } }] },
      { type: 'inlineMath', attrs: { latex: 'x^2' }, marks: [{ type: 'textStyle', attrs: { color: 'var(--p-blue)' } }] },
    ] }] };
    const html = pageExportBody(decodePageDocument(encodePageDocument(doc)), { title: 'Cores', resolve: (text) => text.replace('@{test}', 'Menção') });
    expect(html).toContain('<strong><span style="color:#8150bd">Roxo</span></strong>');
    expect(html).toContain('background:color-mix(in oklab, #279464 28%, transparent)');
    expect(html).toContain('<span class="mention" style="color:#d14262">Menção</span>');
    expect(html).toContain('<span style="color:#3480cc"><span class="math-inline"><span class="katex">');
    expect(html).not.toContain('var(--p-');
  });
  it('rejects injected CSS in colors while preserving code syntax, formulas and circular task markers', () => {
    const html = pageExportBody({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Seguro', marks: [{ type: 'textStyle', attrs: { color: 'var(--p-red);background:url(secret)' } }] }] },
      { type: 'taskList', content: [true, false].map((checked) => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text: checked ? 'Concluído' : 'Pendente' }] }] })) },
      { type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: 'const total = 42;\n// Exemplo' }] },
      { type: 'blockMath', attrs: { latex: '\\frac{a}{b}' } },
    ] }, { title: 'Blocos', resolve: (text) => text });
    expect(html).not.toContain('secret');
    expect(html).toContain('class="task-item" data-checked="true"');
    expect(html).toContain('class="task-item" data-checked="false"');
    expect(html.match(/class="task-check"/g)).toHaveLength(2);
    expect(html).not.toMatch(/[☑☐]/);
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('katex-display');
    expect(html).toContain('mfrac');
    expect(html).not.toContain('katex-error');
  });
  it('uses the existing slug utility and timestamp fallback for filenames', () => {
    expect(pdfFilename('Minha_Página / relatório')).toBe('minha-pagina-relatorio.pdf');
    expect(pdfFilename('', new Date('2026-10-25T12:34:56.789Z'))).toBe('cubspage_20261025123456789.pdf');
  });
});
