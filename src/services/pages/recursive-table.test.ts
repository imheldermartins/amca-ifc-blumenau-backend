import { describe, expect, it } from 'vitest';
import { defaultRecursiveConfig, normalizeRecursiveTable, pdfColumn, recursiveTable, recursiveTableHtml, recursiveToken, relationColumn, relationTitle, type RecursiveRow } from './recursive-template.js';

describe('native recursive table', () => {
  const config = { ...defaultRecursiveConfig(), relationColumnId: 'relation' };
  const cell = (id: string, column: number, text: string, colSpan = 1, rowSpan = 1) => ({ id, column, text, colSpan, rowSpan, header: false });
  const rows: RecursiveRow[] = [
    { id: 'one', title: 'BLA-001', values: { amount: '100' }, dates: {} },
    { id: 'two', title: 'BLA-002', values: { amount: '200' }, dates: {} },
  ];
  it('repeats destination properties per related page and renders the page total once with colspan', () => {
    const table = { columns: 2, rows: [
      { id: 'items', mode: 'repeat' as const, cells: [cell('title', 0, recursiveToken(relationTitle('relation'))), cell('amount', 1, recursiveToken(relationColumn('relation', 'amount')))] },
      { id: 'total', mode: 'static' as const, cells: [cell('total-value', 0, `Total: ${recursiveToken(pdfColumn('total'))}`, 2)] },
    ] };
    const html = recursiveTableHtml({ ...config, table }, rows, (id) => id === pdfColumn('total') ? '300' : '');
    expect(html).toContain('BLA-001</td>'); expect(html).toContain('BLA-002</td>');
    expect(html).toContain('>100</td>'); expect(html).toContain('>200</td>');
    expect(html.match(/Total: 300/g)).toHaveLength(1);
    expect(html).toContain('<td colspan="2" rowspan="1">Total: 300</td>');
    expect(html).not.toContain('@{');
    expect(recursiveTableHtml({ ...config, table }, [], (id) => id === pdfColumn('total') ? '0' : '')).toContain('Total: 0');
    expect(recursiveTableHtml({ ...config, table }, [], () => '')).not.toContain('BLA-');
  });
  it('keeps merged rows within each repeated item and refuses spans across context boundaries', () => {
    const table = normalizeRecursiveTable({ columns: 2, rows: [
      { id: 'a', mode: 'repeat', cells: [cell('a1', 0, 'A'), cell('a2', 1, 'B')] },
      { id: 'b', mode: 'repeat', cells: [cell('b1', 0, 'C'), cell('b2', 1, 'D')] },
      { id: 'footer', mode: 'static', cells: [cell('f1', 0, 'Total'), cell('f2', 1, '300')] },
    ] })!;
    const merged = normalizeRecursiveTable({ ...table, rows: [
      { ...table.rows[0], cells: [cell('a1', 0, 'A\nC', 1, 2), cell('a2', 1, 'B')] },
      { ...table.rows[1], cells: [cell('b2', 1, 'D', 1, 2)] },
      table.rows[2],
    ] })!;
    expect(merged.rows[0]!.cells[0]!.rowSpan).toBe(2);
    expect(merged.rows[1]!.cells.map((entry) => entry.id)).toEqual(['b2']);
    expect(merged.rows[1]!.cells[0]!.rowSpan).toBe(1);
    const html = recursiveTableHtml({ ...config, table: merged }, rows);
    expect(html.match(/rowspan="2"/g)).toHaveLength(2);
  });
  it('upgrades legacy fields to destination-scoped cells and bounds malformed spans', () => {
    const table = recursiveTable(config);
    expect(table.rows[1]!.cells[0]!.text).toBe(recursiveToken(relationTitle('relation')));
    const bounded = normalizeRecursiveTable({ columns: 2, rows: [{ id: 'r', mode: 'repeat', cells: [cell('wide', 0, '<script>', 100, 100), cell('overlap', 0, 'bad')] }] })!;
    expect(bounded.rows[0]!.cells).toHaveLength(1);
    expect(bounded.rows[0]!.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 1 });
    expect(recursiveTableHtml({ ...config, table: bounded }, rows)).toContain('&lt;script&gt;');
  });
  it('retains safe horizontal/vertical alignment for merged PDF cells and discards invalid styles', () => {
    const table = normalizeRecursiveTable({ columns: 2, rows: [{ id: 'total', mode: 'static', cells: [{ ...cell('total', 0, 'Total', 2), header: true, horizontalAlign: 'right', verticalAlign: 'middle' }] }] })!;
    const html = recursiveTableHtml({ ...config, table }, []);
    expect(html).toContain('<th colspan="2" rowspan="1" style="text-align:right;vertical-align:middle">Total</th>');
    const unsafe = normalizeRecursiveTable({ columns: 1, rows: [{ id: 'bad', mode: 'static', cells: [{ ...cell('bad', 0, 'Seguro'), horizontalAlign: 'left;background:url(test)', verticalAlign: 'evil' }] }] })!;
    expect(recursiveTableHtml({ ...config, table: unsafe }, [])).not.toContain('style=');
  });
});
