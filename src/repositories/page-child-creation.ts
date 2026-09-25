import { ulid } from 'ulid';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Vincula a linha à base na mesma transação que cria página, role e relógio. */
export function pageChildEdgeStatement(parentId: string, childId: string): RqliteStatement {
  if (!ULID_RE.test(parentId) || !ULID_RE.test(childId)) throw new Error('Invalid page id');
  return [
    `INSERT INTO page_edges (id, parent_id, child_id)
     SELECT ?, id, ? FROM pages WHERE id = ? AND deleted_at IS NULL`,
    ulid(), childId, parentId,
  ];
}
