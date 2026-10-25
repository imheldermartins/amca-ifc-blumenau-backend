import { describe, expect, it } from 'vitest';
import { assertHeatmapColumns, parsePageViewHeatmapConfig } from '@/services/pages/views/page-view-parsers';
import type { Schema } from '@/db/schemas/index';

const DATE = '01M00000000000000000000001' as Schema.PageColumn['id'];
const CHECK = '01M00000000000000000000002' as Schema.PageColumn['id'];
const OTHER = '01M00000000000000000000003' as Schema.PageColumn['id'];
const config = { version: 2, dateColumnId: DATE, checkboxColumnIds: [CHECK, OTHER], period: { mode: 'year' } };

describe('heatmap configuration', () => {
  it('normalizes legacy configuration and accepts multiple checkboxes', () => {
    expect(parsePageViewHeatmapConfig(config)).toEqual(config);
    expect(parsePageViewHeatmapConfig({ version: 1, dateColumnId: DATE, checkboxColumnId: CHECK, period: { mode: 'year' } }))
      .toEqual({ ...config, checkboxColumnIds: [CHECK] });
  });
  it.each([[], [CHECK, CHECK], ['invalid'], [CHECK, 42], null])('rejects invalid checkbox selections: %j', (checkboxColumnIds) => {
    expect(() => parsePageViewHeatmapConfig({ ...config, checkboxColumnIds })).toThrow();
  });
  it('rejects mixed versions, invalid periods and columns outside the base or of another type', () => {
    expect(() => parsePageViewHeatmapConfig({ ...config, checkboxColumnId: CHECK })).toThrow();
    expect(() => parsePageViewHeatmapConfig({ ...config, period: { mode: 'months', monthCount: 13 } })).toThrow();
    const columns = [{ id: DATE, type: 'date' as const }, { id: CHECK, type: 'checkbox' as const }];
    const parsed = parsePageViewHeatmapConfig(config);
    expect(() => assertHeatmapColumns(parsed, columns)).toThrow();
    expect(() => assertHeatmapColumns(parsed, [...columns, { id: OTHER, type: 'text' }])).toThrow();
    expect(() => assertHeatmapColumns(parsed, [...columns, { id: OTHER, type: 'checkbox' }])).not.toThrow();
  });
});
