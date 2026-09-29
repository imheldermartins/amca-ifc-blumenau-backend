import { ulid } from "ulid";

import type { Schema } from "@/db/schemas/index";
import db from "@models/index";
import type {
  PinnedSchedulePageRow,
  SchedulePinTargetRow,
  SchedulePropertyRow,
} from "@/repositories/types/schedule-repository.types";
import { accessGuard } from "@/repositories/scoped-access-repository";

export interface UpsertSchedulePinInput {
  workspaceId: NonEmptyString;
  pageId: NonEmptyString;
  userId: NonEmptyString;
  dateColumnId: NonEmptyString;
  colorColumnId: NonEmptyString | null;
}

/** Persistência do schedule. SQL de joins/CTE fica isolado nesta camada. */
export class ScheduleStore {
  /** Uma única leitura resolve a visibilidade atual de todos os pins. */
  public async listReadablePageIds(
    userId: NonEmptyString,
    pageIds: readonly NonEmptyString[],
  ): Promise<Set<string>> {
    const uniqueIds = [...new Set(pageIds)];
    if (uniqueIds.length === 0) return new Set();
    const values: unknown[] = [];
    const text = uniqueIds.map((pageId) => {
      const guard = accessGuard("page", pageId, userId, "read", "view");
      values.push(pageId, ...guard.values);
      return `SELECT ? AS page_id WHERE ${guard.text}`;
    }).join(" UNION ALL ");
    const rows = await db.sqlRaw<{ page_id: string }>({ text, values }, "query");
    return new Set(rows.map((row) => row.page_id));
  }

  public async resolvePinTarget(
    workspaceId: NonEmptyString,
    pageId: NonEmptyString,
    dateColumnId: NonEmptyString,
    colorColumnId: NonEmptyString | null,
  ): Promise<SchedulePinTargetRow | null> {
    const text = `WITH RECURSIVE ancestors(id) AS (
      SELECT ?
      UNION
      SELECT edge.parent_id
      FROM page_edges edge
      JOIN ancestors child ON edge.child_id = child.id
    )
    SELECT date_column.parent_id AS source_page_id, source.title AS source_title
    FROM pages page
    JOIN page_columns date_column
      ON date_column.id = ?
      AND date_column.type = 'date'
      AND date_column.deleted_at IS NULL
    JOIN page_edges source_edge
      ON source_edge.child_id = page.id
      AND source_edge.parent_id = date_column.parent_id
    JOIN pages source
      ON source.id = date_column.parent_id
      AND source.deleted_at IS NULL
    JOIN page_columns_values date_value
      ON date_value.page_id = page.id
      AND date_value.page_column_id = date_column.id
    LEFT JOIN page_columns color_column ON color_column.id = ?
    WHERE page.id = ?
      AND page.deleted_at IS NULL
      AND (
        ? IS NULL OR (
          color_column.id IS NOT NULL
          AND color_column.type = 'select'
          AND color_column.deleted_at IS NULL
          AND color_column.parent_id = date_column.parent_id
        )
      )
      AND EXISTS (
        SELECT 1 FROM ancestors ancestor
        WHERE ancestor.id = ?
          OR EXISTS (
            SELECT 1 FROM workspace_members member
            WHERE member.workspace_id = ?
              AND member.page_root_id = ancestor.id
              AND member.deleted_at IS NULL
          )
      )
    LIMIT 1`;
    const rows = await db.sqlRaw<SchedulePinTargetRow>({
      text,
      values: [
        pageId,
        dateColumnId,
        colorColumnId,
        pageId,
        colorColumnId,
        workspaceId,
        workspaceId,
      ],
    }, "query");
    return rows[0] ?? null;
  }

  public async upsert(input: UpsertSchedulePinInput): Promise<Schema.PinnedSchedulePage | null> {
    const text = `INSERT INTO pinned_schedule_pages (
      id, workspace_id, page_id, pinned_by_user_id, date_column_id, color_column_id
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, pinned_by_user_id, page_id) DO UPDATE SET
      date_column_id = excluded.date_column_id,
      color_column_id = excluded.color_column_id,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`;
    const rows = await db.sqlRaw<Schema.PinnedSchedulePage>({
      text,
      values: [
        ulid(),
        input.workspaceId,
        input.pageId,
        input.userId,
        input.dateColumnId,
        input.colorColumnId,
      ],
    }, "request");
    return rows[0] ?? null;
  }

  public async delete(
    workspaceId: NonEmptyString,
    userId: NonEmptyString,
    pageId: NonEmptyString,
  ): Promise<boolean> {
    return db.pinnedSchedulePages.delete({
      workspace_id: workspaceId,
      pinned_by_user_id: userId,
      page_id: pageId,
    } satisfies LookupValues<Schema.PinnedSchedulePage>);
  }

  public list(
    workspaceId: NonEmptyString,
    userId: NonEmptyString,
  ): Promise<PinnedSchedulePageRow[]> {
    const text = `SELECT pin.*, page.title AS page_title,
      date_column.parent_id AS source_page_id,
      source.title AS source_title,
      date_value.data AS date_value_data
    FROM pinned_schedule_pages pin
    JOIN pages page ON page.id = pin.page_id AND page.deleted_at IS NULL
    JOIN page_columns date_column
      ON date_column.id = pin.date_column_id
      AND date_column.type = 'date'
      AND date_column.deleted_at IS NULL
    JOIN page_edges source_edge
      ON source_edge.child_id = page.id
      AND source_edge.parent_id = date_column.parent_id
    JOIN pages source ON source.id = date_column.parent_id AND source.deleted_at IS NULL
    JOIN page_columns_values date_value
      ON date_value.page_id = page.id
      AND date_value.page_column_id = date_column.id
    LEFT JOIN page_columns color_column
      ON color_column.id = pin.color_column_id
      AND color_column.type = 'select'
      AND color_column.deleted_at IS NULL
      AND color_column.parent_id = date_column.parent_id
    WHERE pin.workspace_id = ?
      AND pin.pinned_by_user_id = ?
      AND (pin.color_column_id IS NULL OR color_column.id IS NOT NULL)
    ORDER BY pin.created_at, pin.id`;
    return db.sqlRaw<PinnedSchedulePageRow>({ text, values: [workspaceId, userId] }, "query");
  }

  public listProperties(
    workspaceId: NonEmptyString,
    userId: NonEmptyString,
  ): Promise<SchedulePropertyRow[]> {
    const text = `SELECT pin.page_id,
      column.id AS column_id,
      column.name AS column_name,
      column.type AS column_type,
      column.data AS column_data,
      value.data AS value_data
    FROM pinned_schedule_pages pin
    JOIN page_columns date_column
      ON date_column.id = pin.date_column_id
      AND date_column.deleted_at IS NULL
    JOIN page_columns column
      ON column.parent_id = date_column.parent_id
      AND column.deleted_at IS NULL
    JOIN page_columns_values value
      ON value.page_id = pin.page_id
      AND value.page_column_id = column.id
    WHERE pin.workspace_id = ?
      AND pin.pinned_by_user_id = ?
    ORDER BY pin.created_at, column.created_at, column.id`;
    return db.sqlRaw<SchedulePropertyRow>({ text, values: [workspaceId, userId] }, "query");
  }
}

export default new ScheduleStore();
