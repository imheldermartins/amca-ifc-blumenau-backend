import { ulid } from "ulid";
import db from "@models/index";
import type { Model } from "@/db/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { SystemRoleFactory } from "@/db/repositories/system-role-factory";
import { pageActivityTouchStatement } from "@/db/repositories/page-activity";
import { pageChildEdgeStatement } from "@/db/repositories/page-child-creation";
import type {
  PageBreadcrumbRow,
  PageChildCreationData,
  PageDatasetDatabaseRow,
  PageDatasetRow,
  ParentPageRow,
} from "@/db/types/page-hierarchy-store.types";

/** Queries e transações próprias da árvore de páginas. */
export class PageHierarchyStore {
  public constructor(private readonly pages: Model<Schema.Page> = db.pages) {}

  public async createChild(
    parentId: NonEmptyString,
    ownerId: NonEmptyString,
    input: PageChildCreationData,
  ) {
    const parent = await this.pages.find({ id: parentId } as LookupValues<Schema.Page>);
    if (!parent) return null;

    const childId = ulid();
    return this.pages.createWithId(childId, {
      title: input.title ?? null,
      owner_id: ownerId,
      data: input.data ?? {},
    }, {
      after: [
        SystemRoleFactory.defaultStatement("page", childId),
        pageChildEdgeStatement(parentId, childId),
        pageActivityTouchStatement(parentId),
      ],
    });
  }

  public async getParentId(pageId: NonEmptyString): Promise<NonEmptyString | null> {
    const rows = await db.sqlRaw<ParentPageRow>(
      { text: "SELECT parent_id FROM page_edges WHERE child_id = ? LIMIT 1", values: [pageId] },
      "query",
    );
    return rows[0]?.parent_id ?? null;
  }

  public async findDataset(parentId: NonEmptyString): Promise<PageDatasetRow[]> {
    const text =
      `SELECT p.id AS page_id, p.title AS page_title, ` +
      `json_group_object(pc.id, json_object(` +
      `'row_id', pcv.id, 'row_data', pcv.data, ` +
      `'column_name', pc.name, 'column_type', pc.type, 'column_data', pc.data` +
      `)) AS page_columns ` +
      `FROM pages p ` +
      `INNER JOIN page_edges ph ON ph.child_id = p.id ` +
      `LEFT JOIN page_columns_values pcv ON p.id = pcv.page_id ` +
      `AND EXISTS (` +
      `SELECT 1 FROM page_columns active_pc ` +
      `WHERE active_pc.id = pcv.page_column_id AND active_pc.deleted_at IS NULL` +
      `) ` +
      `LEFT JOIN page_columns pc ON pcv.page_column_id = pc.id AND pc.deleted_at IS NULL ` +
      `WHERE ph.parent_id = ? AND p.deleted_at IS NULL ` +
      `GROUP BY p.id, p.title`;

    const rows = await db.sqlRaw<PageDatasetDatabaseRow>(
      { text, values: [parentId] },
      "query",
    );
    return rows.map((row) => ({
      ...row,
      page_columns: row.page_columns
        ? JSON.parse(row.page_columns) as Record<string, unknown>
        : {},
    }));
  }

  public findBreadcrumb(pageId: NonEmptyString): Promise<PageBreadcrumbRow[]> {
    const text =
      `WITH RECURSIVE ancestors(id, parent_id, depth) AS (` +
      `SELECT pe.child_id, pe.parent_id, 0 ` +
      `FROM page_edges pe ` +
      `JOIN pages child ON child.id = pe.child_id AND child.deleted_at IS NULL ` +
      `JOIN pages parent ON parent.id = pe.parent_id AND parent.deleted_at IS NULL ` +
      `WHERE pe.child_id = ? ` +
      `UNION ALL ` +
      `SELECT pe.child_id, pe.parent_id, a.depth + 1 ` +
      `FROM page_edges pe ` +
      `JOIN ancestors a ON pe.child_id = a.parent_id ` +
      `JOIN pages parent ON parent.id = pe.parent_id AND parent.deleted_at IS NULL` +
      `) SELECT * FROM ancestors ORDER BY depth DESC`;

    return db.sqlRaw<PageBreadcrumbRow>(
      { text, values: [pageId] },
      "query",
    );
  }
}

export default new PageHierarchyStore();
