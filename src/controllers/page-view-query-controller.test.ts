import { describe, expect, it } from 'vitest';
import { parsePageViewQueryRequest } from './page-view-query-controller.js';

describe('query input boundaries', () => {
  it('accepts temporary effective filters without persisting the view', () => {
    const filters = { version: 2, clauses: [{ columnId: 'page_title', condition: 'contains', values: ['ação'] }], groupBy: [], passthrough: [], updatedAt: null };
    expect(parsePageViewQueryRequest({ filters, limit: 50 })).toEqual({ filters: { version: 2, clauses: filters.clauses, groupBy: [] }, limit: 50 });
  });
  it.each([0, 51, -1, 1.1, '50'])('rejects a limit outside the bounded contract: %s', (limit) => {
    expect(() => parsePageViewQueryRequest({ limit })).toThrow(/inválida/);
  });
  it.each([
    { scope: { type: 'calendar', from: '2026-02-30', to: '2026-03-01' } },
    { scope: { type: 'calendar', from: '2026-10-06', to: '2026-10-05' } },
    { scope: { type: 'calendar', from: '2026-10-01', to: '2027-12-01' } },
    { scope: { type: 'calendar', from: '2026-10-01', to: '2026-10-31', day: '2026-11-01' } },
    { scope: { type: 'graph', parentId: "'); DROP TABLE pages; --" } },
    { cursor: 'x'.repeat(4097) },
    { offset: 50 },
  ])('rejects malformed/unbounded scope %j', (request) => {
    expect(() => parsePageViewQueryRequest(request)).toThrow(/inválida/);
  });
  it('requires a real select option ULID, with the reserved neutral exception', () => {
    expect(parsePageViewQueryRequest({ scope: { type: 'board', optionId: '__unassigned__' } })).toEqual({ scope: { type: 'board', optionId: '__unassigned__' } });
    expect(() => parsePageViewQueryRequest({ scope: { type: 'board', optionId: 'Primeiro' } })).toThrow();
  });
});
