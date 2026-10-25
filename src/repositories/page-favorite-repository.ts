import { ulid } from 'ulid';
import db from '@models/index';
import { accessGuard, correlatedPageReadGuard, correlatedWorkspaceReadGuard } from '@/repositories/scoped-access-repository';

export interface FavoritePage {
  pageId: string;
  title: string | null;
  createdAt: string;
  workspaceId: string | null;
  workspaceName: string | null;
}
export interface FavoritePageList { items: FavoritePage[]; nextCursor: string | null; total: number }
export interface FavoriteCursor { id: string; at: string }

/** Personal bookmarks never change page content, ownership, or permissions. */
export class PageFavoriteStore {
  constructor(private readonly execute: typeof db.sqlRaw = db.sqlRaw) {}

  async list(actor: string, limit: number, cursor?: FavoriteCursor): Promise<FavoritePageList> {
    const page = correlatedPageReadGuard('page.id', actor), workspace = correlatedWorkspaceReadGuard('workspace.id', actor);
    const rows = await this.execute<FavoritePage & { favoriteId: string | null; pageId: string | null; total: number }>({
      text: `WITH RECURSIVE visible AS (
        SELECT favorite.id AS favoriteId, page.id AS pageId, page.title, favorite.created_at AS createdAt
        FROM page_favorites favorite JOIN pages page ON page.id=favorite.page_id
        WHERE favorite.user_id=? AND page.deleted_at IS NULL AND ${page.text}
      ), selected AS (
        SELECT * FROM visible ${cursor ? 'WHERE createdAt<? OR (createdAt=? AND favoriteId<?)' : ''}
        ORDER BY createdAt DESC,favoriteId DESC LIMIT ?
      ), ancestry(favoriteId,pageId,depth) AS (
        SELECT favoriteId,pageId,0 FROM selected
        UNION SELECT ancestry.favoriteId,edge.parent_id,ancestry.depth+1 FROM ancestry
          JOIN page_edges edge ON edge.child_id=ancestry.pageId
          JOIN pages parent ON parent.id=edge.parent_id AND parent.deleted_at IS NULL WHERE ancestry.depth<64
      ), locations AS (
        SELECT ancestry.favoriteId,workspace.id,workspace.name,
          ROW_NUMBER() OVER(PARTITION BY ancestry.favoriteId ORDER BY ancestry.depth,workspace.id) AS priority
        FROM ancestry JOIN workspace_members member ON member.page_root_id=ancestry.pageId AND member.deleted_at IS NULL
        JOIN workspaces workspace ON workspace.id=member.workspace_id WHERE ${workspace.text}
      ) SELECT selected.*,locations.id AS workspaceId,locations.name AS workspaceName,metadata.total
        FROM (SELECT COUNT(*) AS total FROM visible) metadata LEFT JOIN selected ON 1=1
        LEFT JOIN locations ON locations.favoriteId=selected.favoriteId AND locations.priority=1
        ORDER BY selected.createdAt DESC,selected.favoriteId DESC`,
      values: [actor, ...page.values, ...(cursor ? [cursor.at, cursor.at, cursor.id] : []), limit + 1, ...workspace.values],
    }, 'query');
    const visible = rows.filter((row) => row.pageId !== null);
    const items = visible.slice(0, limit).map(({ pageId, title, createdAt, workspaceId, workspaceName }) => ({ pageId, title, createdAt, workspaceId, workspaceName }));
    const last = visible[limit - 1];
    return { items, total: Number(rows[0]?.total ?? 0), nextCursor: visible.length > limit && last
      ? Buffer.from(JSON.stringify({ id: last.favoriteId, at: last.createdAt })).toString('base64url') : null };
  }

  async state(actor: string, pageId: string): Promise<boolean | null> {
    const guard = accessGuard('page', pageId, actor, 'read', 'view');
    const [row] = await this.execute<{ favorite: number }>({
      text: `SELECT EXISTS(SELECT 1 FROM page_favorites favorite WHERE favorite.user_id=? AND favorite.page_id=page.id) AS favorite
        FROM pages page WHERE page.id=? AND page.deleted_at IS NULL AND ${guard.text}`,
      values: [actor, pageId, ...guard.values],
    }, 'query');
    return row ? Boolean(row.favorite) : null;
  }

  async add(actor: string, pageId: string): Promise<boolean> {
    const guard = accessGuard('page', pageId, actor, 'read', 'view');
    const rows = await this.execute<{ id: string }>({
      text: `INSERT INTO page_favorites(id,user_id,page_id)
        SELECT ?,?,page.id FROM pages page WHERE page.id=? AND page.deleted_at IS NULL AND ${guard.text}
        ON CONFLICT(user_id,page_id) DO UPDATE SET page_id=excluded.page_id RETURNING id`,
      values: [ulid(), actor, pageId, ...guard.values],
    }, 'request');
    return rows.length === 1;
  }

  async remove(actor: string, pageId: string): Promise<void> {
    // A user can always remove their own bookmark, even after losing page access.
    await this.execute({ text: 'DELETE FROM page_favorites WHERE user_id=? AND page_id=? RETURNING id', values: [actor, pageId] }, 'request');
  }
}
export default new PageFavoriteStore();
