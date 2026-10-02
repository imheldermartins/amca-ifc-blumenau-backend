import { rqlite } from '@/db/client-db';
import type { Schema } from '@/db/schemas/index';
import db from '@models/index';
import { accessGuard } from '@/repositories/scoped-access-repository';
import type { EmailOutboxPayload } from '@/repositories/types/notification-repository.types';
import type {
  SchedulePinRequestRow,
  ScheduleRecipientRow,
  ScheduleRequestContextRow,
} from '@/repositories/types/schedule-repository.types';

export interface CreateSchedulePinRequestInput {
  requestId: NonEmptyString;
  notificationId: NonEmptyString;
  deliveryId: NonEmptyString;
  workspaceId: NonEmptyString;
  pageId: NonEmptyString;
  requestedByUserId: NonEmptyString;
  recipientUserId: NonEmptyString;
  dateColumnId: NonEmptyString;
  colorColumnId: NonEmptyString | null;
  notificationData: Record<string, unknown>;
  email: EmailOutboxPayload;
}

function structuralTargetSql(): string {
  return `EXISTS (
    SELECT 1
    FROM pages page
    JOIN page_columns date_column
      ON date_column.id = ?
      AND date_column.type = 'date'
      AND date_column.deleted_at IS NULL
    JOIN page_edges source_edge
      ON source_edge.child_id = page.id
      AND source_edge.parent_id = date_column.parent_id
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
        WITH RECURSIVE ancestors(id) AS (
          SELECT page.id
          UNION
          SELECT edge.parent_id FROM page_edges edge JOIN ancestors ON edge.child_id = ancestors.id
        )
        SELECT 1 FROM ancestors
        WHERE ancestors.id = ? OR EXISTS (
          SELECT 1 FROM workspace_members member
          WHERE member.workspace_id = ?
            AND member.page_root_id = ancestors.id
            AND member.deleted_at IS NULL
        )
      )
  )`;
}

function structuralTargetValues(input: {
  dateColumnId: string;
  colorColumnId: string | null;
  pageId: string;
  workspaceId: string;
}): unknown[] {
  return [
    input.dateColumnId,
    input.colorColumnId,
    input.pageId,
    input.colorColumnId,
    input.workspaceId,
    input.workspaceId,
  ];
}

export class SchedulePinRequestStore {
  public async requestContext(
    pageId: NonEmptyString,
    actorId: NonEmptyString,
  ): Promise<ScheduleRequestContextRow | null> {
    const rows = await db.sqlRaw<ScheduleRequestContextRow>({
      text: `SELECT page.title AS page_title, actor.name AS actor_name,
        actor.email AS actor_email
      FROM pages page JOIN users actor ON actor.id = ?
      WHERE page.id = ? AND page.deleted_at IS NULL
      LIMIT 1`,
      values: [actorId, pageId],
    }, 'query');
    return rows[0] ?? null;
  }

  public async listEligibleRecipients(
    workspaceId: NonEmptyString,
    pageId: NonEmptyString,
    actorId: NonEmptyString,
  ): Promise<ScheduleRecipientRow[]> {
    const candidates = await db.sqlRaw<ScheduleRecipientRow>({
      text: `WITH RECURSIVE branch(id) AS (
        SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL
        UNION
        SELECT edge.parent_id FROM page_edges edge
        JOIN branch child ON child.id = edge.child_id
        JOIN pages parent ON parent.id = edge.parent_id AND parent.deleted_at IS NULL
      ), candidate_ids(id) AS (
        SELECT created_by_user_id FROM workspaces WHERE id = ?
        UNION SELECT user_id FROM workspace_members
          WHERE workspace_id = ? AND deleted_at IS NULL
        UNION SELECT organization.owner_id FROM organizations organization
          JOIN workspaces workspace ON workspace.organization_id = organization.id
          WHERE workspace.id = ?
        UNION SELECT member.user_id FROM organization_members member
          JOIN workspaces workspace ON workspace.organization_id = member.organization_id
          WHERE workspace.id = ? AND member.deleted_at IS NULL
        UNION SELECT owner_id FROM pages WHERE id IN (SELECT id FROM branch)
        UNION SELECT collaborator.user_id FROM page_collaborators collaborator
          WHERE collaborator.page_id IN (SELECT id FROM branch)
            AND collaborator.deleted_at IS NULL
      )
      SELECT user.id, user.name, user.email
      FROM users user JOIN candidate_ids candidate ON candidate.id = user.id
      WHERE user.id <> ?
      ORDER BY COALESCE(user.name, user.email), user.id`,
      values: [pageId, workspaceId, workspaceId, workspaceId, workspaceId, actorId],
    }, 'query');
    if (!candidates.length) return [];

    const values: unknown[] = [];
    const checks = candidates.map((candidate) => {
      const page = accessGuard('page', pageId, candidate.id, 'read', 'view');
      const workspace = accessGuard('workspace', workspaceId, candidate.id, 'read', 'view');
      values.push(candidate.id, ...page.values, ...workspace.values);
      return `SELECT ? AS id WHERE ${page.text} AND ${workspace.text}`;
    });
    const allowed = await db.sqlRaw<{ id: string }>({
      text: checks.join(' UNION ALL '),
      values,
    }, 'query');
    const ids = new Set(allowed.map((row) => row.id));
    return candidates.filter((candidate) => ids.has(candidate.id));
  }

  public async create(input: CreateSchedulePinRequestInput): Promise<boolean> {
    const requesterPage = accessGuard('page', input.pageId, input.requestedByUserId, 'read', 'view');
    const recipientPage = accessGuard('page', input.pageId, input.recipientUserId, 'read', 'view');
    const recipientWorkspace = accessGuard(
      'workspace',
      input.workspaceId,
      input.recipientUserId,
      'read',
      'view',
    );
    const results = await rqlite([
      [`INSERT OR IGNORE INTO schedule_pin_requests (
        id, workspace_id, page_id, requested_by_user_id, recipient_user_id,
        date_column_id, color_column_id, status
      ) SELECT ?, ?, ?, ?, ?, ?, ?, 'pending'
        WHERE ? <> ?
          AND ${requesterPage.text}
          AND ${recipientPage.text}
          AND ${recipientWorkspace.text}
          AND ${structuralTargetSql()}`,
      input.requestId,
      input.workspaceId,
      input.pageId,
      input.requestedByUserId,
      input.recipientUserId,
      input.dateColumnId,
      input.colorColumnId,
      input.requestedByUserId,
      input.recipientUserId,
      ...requesterPage.values,
      ...recipientPage.values,
      ...recipientWorkspace.values,
      ...structuralTargetValues(input)],
      [`INSERT INTO notifications (
        id, workspace_id, recipient_user_id, actor_user_id, type,
        resource_type, resource_id, data, dedupe_key
      ) SELECT ?, ?, ?, ?, 'schedule_pin_request', 'schedule_pin_request', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM schedule_pin_requests WHERE id = ?)`,
      input.notificationId,
      input.workspaceId,
      input.recipientUserId,
      input.requestedByUserId,
      input.requestId,
      JSON.stringify(input.notificationData),
      `schedule-pin-request:${input.requestId}`,
      input.requestId],
      [`INSERT INTO notification_deliveries (
        id, notification_id, channel, status, payload
      ) SELECT ?, ?, 'email', 'pending', ?
        WHERE EXISTS (SELECT 1 FROM notifications WHERE id = ?)`,
      input.deliveryId,
      input.notificationId,
      JSON.stringify(input.email),
      input.notificationId],
    ], 'execute', { transaction: true });
    return results[0] === true && results[1] === true && results[2] === true;
  }

  public async findForRecipient(
    workspaceId: NonEmptyString,
    requestId: NonEmptyString,
    recipientUserId: NonEmptyString,
  ): Promise<SchedulePinRequestRow | null> {
    const rows = await db.sqlRaw<SchedulePinRequestRow>({
      text: `SELECT request.*, page.title AS page_title,
        requester.name AS requester_name, requester.email AS requester_email,
        recipient.name AS recipient_name, recipient.email AS recipient_email
      FROM schedule_pin_requests request
      JOIN pages page ON page.id = request.page_id
      JOIN users requester ON requester.id = request.requested_by_user_id
      JOIN users recipient ON recipient.id = request.recipient_user_id
      WHERE request.id = ? AND request.workspace_id = ?
        AND request.recipient_user_id = ?
      LIMIT 1`,
      values: [requestId, workspaceId, recipientUserId],
    }, 'query');
    return rows[0] ?? null;
  }

  public async decide(
    request: SchedulePinRequestRow,
    recipientUserId: NonEmptyString,
    decision: 'accepted' | 'declined',
  ): Promise<boolean> {
    const page = decision === 'accepted'
      ? accessGuard('page', request.page_id, recipientUserId, 'read', 'view')
      : null;
    const workspace = decision === 'accepted'
      ? accessGuard('workspace', request.workspace_id, recipientUserId, 'read', 'view')
      : null;
    const update: RqliteStatement = [
      `UPDATE schedule_pin_requests
        SET status = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND workspace_id = ? AND recipient_user_id = ? AND status = 'pending'
          ${decision === 'accepted' && page && workspace
            ? `AND ${page.text} AND ${workspace.text} AND ${structuralTargetSql()}`
            : ''}`,
      decision,
      request.id,
      request.workspace_id,
      recipientUserId,
      ...(page?.values ?? []),
      ...(workspace?.values ?? []),
      ...(decision === 'accepted' ? structuralTargetValues({
        dateColumnId: request.date_column_id,
        colorColumnId: request.color_column_id,
        pageId: request.page_id,
        workspaceId: request.workspace_id,
      }) : []),
    ];
    const notificationUpdate: RqliteStatement = [
      `UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
          data = json_set(data, '$.status', ?), updated_at = CURRENT_TIMESTAMP
        WHERE resource_type = 'schedule_pin_request' AND resource_id = ?
          AND recipient_user_id = ?`,
      decision,
      request.id,
      recipientUserId,
    ];
    if (decision === 'declined') {
      const results = await rqlite([
        update,
        ["INSERT INTO pages (id, owner_id) SELECT '!', NULL WHERE changes() = 0"],
        notificationUpdate,
      ], 'execute', { transaction: true });
      return results[0] === true;
    }

    const results = await rqlite([
      update,
      ["INSERT INTO pages (id, owner_id) SELECT '!', NULL WHERE changes() = 0"],
      [`INSERT INTO pinned_schedule_pages (
        id, workspace_id, page_id, pinned_by_user_id, date_column_id, color_column_id
      ) SELECT ?, workspace_id, page_id, recipient_user_id, date_column_id, color_column_id
        FROM schedule_pin_requests WHERE id = ? AND status = 'accepted'
      ON CONFLICT(workspace_id, pinned_by_user_id, page_id) DO UPDATE SET
        date_column_id = excluded.date_column_id,
        color_column_id = excluded.color_column_id,
        updated_at = CURRENT_TIMESTAMP`,
      request.id,
      request.id],
      notificationUpdate,
    ], 'execute', { transaction: true });
    return results[0] === true && results[2] === true;
  }
}

export default new SchedulePinRequestStore();
