import db from "@models/index";
import type { Schema } from "@/db/schemas/index";
import type {
  PageCollaboratorStoreContract,
  WorkspaceMembershipRow,
} from "@/db/types/page-collaborator-store.types";

/** Persistência dos vínculos e candidatos de colaboração de uma página. */
export class PageCollaboratorStore implements PageCollaboratorStoreContract {
  public listCollaborators(pageId: NonEmptyString): Promise<Schema.PageCollaboratorSummary[]> {
    const text =
      `SELECT u.id, u.name, u.email ` +
      `FROM page_collaborators pc ` +
      `JOIN users u ON u.id = pc.user_id ` +
      `WHERE pc.page_id = ? AND pc.deleted_at IS NULL ` +
      `ORDER BY u.name`;

    return db.sqlRaw<Schema.PageCollaboratorSummary>(
      { text, values: [pageId] },
      "query",
    );
  }

  public listCandidates(
    pageId: NonEmptyString,
    workspaceId: NonEmptyString,
    email: string,
  ): Promise<Schema.PageCollaboratorSummary[]> {
    const text =
      `SELECT u.id, u.name, u.email ` +
      `FROM workspace_members wm ` +
      `JOIN users u ON u.id = wm.user_id ` +
      `JOIN pages selected_page ON selected_page.id = ? AND selected_page.deleted_at IS NULL ` +
      `WHERE wm.workspace_id = ? AND wm.deleted_at IS NULL ` +
      `AND u.email_verified_at IS NOT NULL AND u.id <> selected_page.owner_id ` +
      `AND NOT EXISTS (` +
        `SELECT 1 FROM page_collaborators pc ` +
        `WHERE pc.page_id = selected_page.id AND pc.user_id = u.id AND pc.deleted_at IS NULL` +
      `) AND lower(trim(u.email)) = ? LIMIT 1`;

    return db.sqlRaw<Schema.PageCollaboratorSummary>(
      { text, values: [pageId, workspaceId, email] },
      "query",
    );
  }

  public findLink(
    pageId: NonEmptyString,
    userId: NonEmptyString,
  ): Promise<Schema.PageCollaborator | null> {
    return db.pageCollaborators.find({
      page_id: pageId,
      user_id: userId,
    } satisfies LookupValues<Schema.PageCollaborator>);
  }

  public async resolveWorkspaceId(pageId: NonEmptyString): Promise<NonEmptyString | null> {
    const text =
      `WITH RECURSIVE branch(id) AS (` +
        `SELECT p.id FROM pages p WHERE p.id = ? AND p.deleted_at IS NULL ` +
        `UNION ` +
        `SELECT pe.parent_id FROM page_edges pe ` +
        `JOIN branch child ON child.id = pe.child_id ` +
        `JOIN pages parent ON parent.id = pe.parent_id AND parent.deleted_at IS NULL` +
      `) SELECT wm.workspace_id ` +
      `FROM workspace_members wm ` +
      `JOIN branch ON branch.id = wm.page_root_id ` +
      `WHERE wm.deleted_at IS NULL LIMIT 1`;
    const rows = await db.sqlRaw<WorkspaceMembershipRow>(
      { text, values: [pageId] },
      "query",
    );
    return rows[0]?.workspace_id ?? null;
  }
}

export default new PageCollaboratorStore();
