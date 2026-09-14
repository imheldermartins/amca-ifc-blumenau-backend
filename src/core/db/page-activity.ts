import { rqlite } from './shared.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Recarimba a página no mesmo commit de uma alteração do seu conteúdo. */
export function pageActivityTouchStatement(pageId: string): RqliteStatement {
  if (!ULID_RE.test(pageId)) throw new Error('Invalid page id');
  return [
    "UPDATE pages SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL",
    pageId,
  ];
}

/** A última edição real da página ou de qualquer descendente ativa. */
export async function readPageLatestUpdatedAt(pageId: string): Promise<string | null> {
  if (!ULID_RE.test(pageId)) return null;
  const [rows] = await rqlite<{ updated_at: string }>([[
    `WITH RECURSIVE descendants(id) AS (
       SELECT ?
       UNION
       SELECT edge.child_id FROM page_edges edge
       JOIN descendants ancestor ON ancestor.id = edge.parent_id
       JOIN pages child ON child.id = edge.child_id AND child.deleted_at IS NULL
     )
     SELECT page.updated_at FROM descendants
     JOIN pages page ON page.id = descendants.id
     WHERE page.deleted_at IS NULL
       AND julianday(page.updated_at) > julianday(page.created_at)
     ORDER BY julianday(page.updated_at) DESC, page.updated_at DESC LIMIT 1`,
    pageId,
  ]], 'query');
  return rows?.[0]?.updated_at ?? null;
}
