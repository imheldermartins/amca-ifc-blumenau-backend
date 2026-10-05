import { describe, expect, it } from 'vitest';
import type { Schema } from '@/db/schemas/index';
import { BOARD_UNASSIGNED, parseBoardPatch } from '@/services/pages/views/page-board-config';
import { PageViewSnapshot } from '@/services/pages/views/page-view-snapshot';
import { PageViewPatchPlanner } from '@/services/pages/views/page-view-patch-planner';
const SELECT = '01KXVZ00000000000000000001';
const OPTION = '01KXVZ00000000000000000002';
const VIEW = '01KXVZ00000000000000000003';
const columns: Schema.PageColumn[] = [{ id: SELECT, parent_id: VIEW, name: 'Tema', type: 'select', data: { options: [{ id: OPTION, value: 'A' }] }, created_at: '', updated_at: '', deleted_at: null }];
describe('Board snapshot validation', () => {
  it('patches only supplied fields, preserving sibling settings', () => {
    const current = { view: 'board', board: { selectColumnId: SELECT, propertyIds: [SELECT], showPropertyLabels: true } };
    const snapshot = PageViewSnapshot.fromPage({ data: { [VIEW]: current } });
    const result = new PageViewPatchPlanner().plan(snapshot, columns, VIEW, current, { board: { showPropertyLabels: false } });
    expect(result.patches).toEqual([{ path: [VIEW, 'board', 'showPropertyLabels'], value: false }]);
  });
  it('accepts canonical option IDs and the unassigned Board', () => {
    expect(parseBoardPatch({ selectColumnId: SELECT, optionOrder: [OPTION, BOARD_UNASSIGNED], propertyIds: [] }, {}, columns))
      .toEqual({ selectColumnId: SELECT, optionOrder: [OPTION, BOARD_UNASSIGNED], propertyIds: [] });
  });
  it('rejects another type, options from another column and malformed visibility', () => {
    expect(() => parseBoardPatch({ selectColumnId: OPTION }, {}, columns)).toThrow('select');
    expect(() => parseBoardPatch({ optionOrder: [VIEW] }, { selectColumnId: SELECT }, columns)).toThrow('inválidas');
    expect(() => parseBoardPatch({ showPropertyLabels: 'false' }, {}, columns)).toThrow('inválida');
  });
});
