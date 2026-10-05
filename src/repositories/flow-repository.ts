import { ulid } from 'ulid';

import { rqlite } from '@/db/client-db';
import type { Schema } from '@/db/schemas/index';
import db from '@models/index';
import pageCellStore from '@/repositories/page-cell-repository';
import pageCollaboratorStore from '@/repositories/page-collaborator-repository';
import { accessGuard } from '@/repositories/scoped-access-repository';
import type {
  CommitFlowExecutionInput,
  FlowExecutionSource,
  FlowMacroCatalogSource,
  FlowMacroPerson,
} from '@/repositories/types/flow-repository.types';
import { pageCellUpsertStatement } from '@/repositories/page-cell-statements';
import {pageActivityTouchStatement} from '@/repositories/page-activity';

export class FlowStore {
  public async findFlowColumn(
    parentId: NonEmptyString,
    columnId: NonEmptyString,
  ): Promise<Schema.PageColumn | null> {
    const column = await db.pageColumns.find({
      id: columnId,
      parent_id: parentId,
    } satisfies LookupValues<Schema.PageColumn>);
    return column?.type === 'flow' ? column : null;
  }

  public async saveDefinition(
    parentId: NonEmptyString,
    columnId: NonEmptyString,
    definition: Schema.FlowDefinition,
  ): Promise<boolean> {
    const rows = await db.sqlRaw<{ id: string }>({
      text: `UPDATE page_columns
        SET data = json_set(COALESCE(data, '{}'), '$.flow', json(?)),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND parent_id = ? AND type = 'flow' AND deleted_at IS NULL
        RETURNING id`,
      values: [JSON.stringify(definition), columnId, parentId],
    }, 'request');
    return rows.length === 1;
  }

  public async macroCatalog(parentId: NonEmptyString): Promise<FlowMacroCatalogSource | null> {
    const parent = await db.pages.find({ id: parentId } satisfies LookupValues<Schema.Page>);
    const workspaceId = await pageCollaboratorStore.resolveWorkspaceId(parentId);
    if (!parent || !workspaceId) return null;
    const [workspace, columns, people] = await Promise.all([
      db.workspaces.find({ id: workspaceId } satisfies LookupValues<Schema.Workspace>),
      db.pageColumns.findAll({ parent_id: parentId } as LookupsConfig<Schema.PageColumn>),
      this.listPeople(parentId),
    ]);
    if (!workspace) return null;
    return { parent, workspace, columns: columns ?? [], people };
  }

  public async executionSource(
    rowId: NonEmptyString,
    columnId: NonEmptyString,
  ): Promise<FlowExecutionSource | null> {
    const flowColumn = await pageCellStore.findColumnForCell(rowId, columnId);
    if (!flowColumn?.parent_id || flowColumn.type !== 'flow') return null;
    const [catalog, row, values] = await Promise.all([
      this.macroCatalog(flowColumn.parent_id),
      db.pages.find({ id: rowId } satisfies LookupValues<Schema.Page>),
      db.pageColumnValues.findAll({ page_id: rowId } as LookupsConfig<Schema.PageColumnValue>),
    ]);
    if (!catalog || !row) return null;
    return { ...catalog, row, flowColumn, values: values ?? [] };
  }

  /** Persiste todos os efeitos duráveis numa única transação rqlite. */
  public buildExecutionStatements(input: CommitFlowExecutionInput): RqliteStatement[] {
    const statements: RqliteStatement[] = [];
    for (const value of input.values) {
      statements.push(pageCellUpsertStatement(input.source.row.id, value.columnId, value.data));
    }
    for (const email of input.emails) {
      const notificationId = ulid();
      const dedupeKey = `flow-email:${input.executionId}:${email.nodeId}:${email.recipientEmail.toLocaleLowerCase()}`;
      statements.push([
        `INSERT INTO notifications (
          id, workspace_id, recipient_user_id, actor_user_id, type,
          resource_type, resource_id, data, dedupe_key
        ) VALUES (?, ?, ?, ?, 'flow_email', 'flow_execution', ?, ?, ?)`,
        notificationId,
        input.source.workspace.id,
        email.recipientUserId,
        input.actorUserId,
        input.executionId,
        JSON.stringify({
          pageId: input.source.row.id,
          pageTitle: input.source.row.title,
          flowColumnId: input.source.flowColumn.id,
          nodeId: email.nodeId,
          recipientEmail: email.recipientEmail,
        }),
        dedupeKey,
      ]);
      statements.push([
        `INSERT INTO notification_deliveries (
          id, notification_id, channel, status, payload
        ) VALUES (?, ?, 'email', 'pending', ?)`,
        ulid(), notificationId, JSON.stringify(email.payload),
      ]);
    }
    statements.push(pageCellUpsertStatement(
      input.source.row.id,
      input.source.flowColumn.id,
      input.flowColumnData,
    ));
    statements.push(pageActivityTouchStatement(input.source.row.id));
    return statements;
  }

  /** Persiste todos os efeitos duráveis numa única transação rqlite. */
  public async commitExecution(input: CommitFlowExecutionInput): Promise<boolean> {
    const statements = this.buildExecutionStatements(input);
    const results = await rqlite(statements, 'execute', { transaction: true });
    return results.length === statements.length && results.every(Boolean);
  }

  private async listPeople(parentId: NonEmptyString): Promise<FlowMacroPerson[]> {
    const candidates = await db.sqlRaw<FlowMacroPerson>({
      text: `WITH RECURSIVE branch(id) AS (
        SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL
        UNION
        SELECT edge.parent_id FROM page_edges edge
        JOIN branch child ON child.id = edge.child_id
        JOIN pages parent ON parent.id = edge.parent_id AND parent.deleted_at IS NULL
      ), selected_workspaces(id, organization_id) AS (
        SELECT DISTINCT workspace.id, workspace.organization_id
        FROM workspaces workspace
        JOIN workspace_members root ON root.workspace_id = workspace.id AND root.deleted_at IS NULL
        JOIN branch ON branch.id = root.page_root_id
      ), candidate_ids(id) AS (
        SELECT owner_id FROM pages WHERE id IN (SELECT id FROM branch)
        UNION SELECT collaborator.user_id FROM page_collaborators collaborator
          WHERE collaborator.page_id IN (SELECT id FROM branch) AND collaborator.deleted_at IS NULL
        UNION SELECT workspace.created_by_user_id FROM workspaces workspace
          WHERE workspace.id IN (SELECT id FROM selected_workspaces)
        UNION SELECT member.user_id FROM workspace_members member
          WHERE member.workspace_id IN (SELECT id FROM selected_workspaces) AND member.deleted_at IS NULL
        UNION SELECT organization.owner_id FROM organizations organization
          WHERE organization.id IN (SELECT organization_id FROM selected_workspaces)
        UNION SELECT member.user_id FROM organization_members member
          WHERE member.organization_id IN (SELECT organization_id FROM selected_workspaces)
            AND member.deleted_at IS NULL
      )
      SELECT user.id, user.name, user.email FROM users user
      JOIN candidate_ids candidate ON candidate.id = user.id
      ORDER BY COALESCE(user.name, user.email), user.id`,
      values: [parentId],
    }, 'query');
    if (!candidates.length) return [];

    const values: unknown[] = [];
    const probes = candidates.map((candidate) => {
      const guard = accessGuard('page', parentId, candidate.id, 'read', 'view');
      values.push(candidate.id, ...guard.values);
      return `SELECT ? AS id WHERE ${guard.text}`;
    });
    const allowed = await db.sqlRaw<{ id: string }>({
      text: probes.join(' UNION ALL '),
      values,
    }, 'query');
    const ids = new Set(allowed.map((row) => row.id));
    return candidates.filter((candidate) => ids.has(candidate.id));
  }
}

export default new FlowStore();
