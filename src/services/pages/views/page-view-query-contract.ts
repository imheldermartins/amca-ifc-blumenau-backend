/** Portable HTTP projection contract. Keep the frontend copy byte-for-byte. */
export const PAGE_VIEW_QUERY_VERSION = 1 as const;
export const PAGE_VIEW_BATCH_SIZE = 50;
export const PAGE_VIEW_CACHE_ROWS = 250;
export const PAGE_VIEW_UNASSIGNED = '__unassigned__';
export type QueryViewKind = 'table' | 'grid' | 'board' | 'calendar' | 'timeline' | 'graph' | 'form';
export interface QueryFilterClause { columnId: string; condition: 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'between'; values: string[] }
export interface QueryFilters { version: 2; clauses: QueryFilterClause[]; groupBy: string[]; passthrough?: [string, string][]; updatedAt?: string | null }
export interface QueryGroupValue { columnId: string; value: string | null }
export type PageViewQueryScope =
  | { type: 'root' }
  | { type: 'board'; optionId: string }
  | { type: 'group'; path: QueryGroupValue[] }
  | { type: 'calendar'; from: string; to: string; day?: string }
  | { type: 'graph'; parentId: string };
export interface PageViewQueryRequest {
  /** Kind efetivo que o frontend está projetando; o backend confere contra o snapshot. */
  view?: QueryViewKind;
  filters?: QueryFilters;
  scope?: PageViewQueryScope;
  cursor?: string | null;
  direction?: 'next' | 'previous';
  limit?: number;
  /** Initial shared budget is distributed only among these expanded/visible groups. */
  visibleGroupKeys?: string[];
  groupCursor?: string | null;
  metadataOnly?: boolean;
  /** Reconcile the retained slice, including its first row, without restarting at the beginning. */
  anchorId?: string;
}
export interface QueryDatasetCell {
  row_id: string | null;
  row_data: string | null;
  column_name: string | null;
  column_type: 'text' | 'numeric' | 'select' | 'date' | 'checkbox' | 'flow' | null;
  column_data: string | null;
}
export interface QueryDatasetRow { page_id: string; page_title: string | null; page_columns: Record<string, QueryDatasetCell> }
export interface PageViewQueryWindow {
  key: string;
  scope: PageViewQueryScope;
  rows: QueryDatasetRow[];
  total: number;
  nextCursor: string | null;
  previousCursor: string | null;
}
export interface PageViewQueryGroup {
  key: string;
  label: string;
  color?: string;
  columnId?: string;
  value?: string | null;
  path: QueryGroupValue[];
  total: number;
  windowKey?: string;
  children?: PageViewQueryGroup[];
  nextCursor?: string | null;
}
export interface PageViewQueryProjection {
  version: 1;
  kind: QueryViewKind;
  pageId: string;
  viewId: string;
  queryKey: string;
  orderRevision: number;
  datasetRevision?: number;
  total: number;
  windows: PageViewQueryWindow[];
  groups?: PageViewQueryGroup[];
  groupsNextCursor?: string | null;
  /** Full authorized counts, independent of the capped preview rows. */
  days?: Record<string, number>;
  initialDate?: string;
  selectColumnId?: string;
  dateColumnId?: string;
}
export interface PageViewRowMoveInput {
  rowId: string;
  beforeId?: string;
  afterId?: string;
  boundary?: 'start' | 'end';
  expectedOrderRevision: number;
  /** Omission reorders without changing a cell; null explicitly clears the select. */
  targetOptionId?: string | null;
  previousOptionId?: string | null;
}
export interface PageViewRowMoveResult { rowId: string; orderRevision: number; selectColumnId?: string; optionId?: string | null }
export function pageViewScopeKey(scope: PageViewQueryScope): string {
  switch (scope.type) {
    case 'root': return 'root';
    case 'board': return `board:${scope.optionId}`;
    case 'group': return `group:${JSON.stringify(scope.path)}`;
    case 'calendar': return `calendar:${scope.from}:${scope.to}:${scope.day ?? ''}`;
    case 'graph': return `graph:${scope.parentId}`;
  }
}
