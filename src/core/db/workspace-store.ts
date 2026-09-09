import { rqlite } from "@db/shared";
import db from "@models/index";
import type { Schema } from "@/models/schemas/index";

export interface WorkspaceSummary {
  id: string;
  name: string | null;
  data: Record<string, unknown>;
  organizationId: string | null;
  organizationName: string | null;
  icon: string;
  createdByUserId: string | null;
  role: Schema.WorkspaceRole;
  pageRootId: string;
}

interface WorkspaceSummaryRow {
  id: string;
  name: string | null;
  data: string | Record<string, unknown> | null;
  organization_id: string | null;
  organization_name: string | null;
  icon: string | null;
  created_by_user_id: string | null;
  role: Schema.WorkspaceRole;
  page_root_id: string;
}

export interface WorkspaceMemberSummary {
  id: string;
  name: string | null;
  email: string;
  role: Schema.WorkspaceRole;
  pageRootId: string;
}

interface WorkspaceMemberRow {
  id: string;
  name: string | null;
  email: string;
  role: Schema.WorkspaceRole;
  page_root_id: string;
}

export interface WorkspaceKeyRecord extends Schema.WorkspaceAccessKey {
  workspace_id: string | null;
  workspace_name: string | null;
}

export interface CreateWorkspaceProvision {
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string;
  organizationId: string | null;
  ownerId: string;
  rootTitle: string;
  membershipId: string;
  keyId: string;
  keyHash: string;
  keyLinkId: string;
  issuedEmail: string;
  issuedName: string;
}

export interface JoinWorkspaceProvision {
  workspaceId: string;
  ownerId: string;
  pageRootId: string;
  rootTitle: string;
  membershipId: string;
  keyId: string;
  keyHash: string;
  issuedEmail: string;
  issuedName: string;
}

function parseData(value: WorkspaceSummaryRow["data"]): Record<string, unknown> {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function summary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    data: parseData(row.data),
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    icon: row.icon ?? "lucide:boxes",
    createdByUserId: row.created_by_user_id,
    role: row.role,
    pageRootId: row.page_root_id,
  };
}

const WORKSPACE_SUMMARY_SELECT = `
  SELECT w.id, w.name, w.data, w.organization_id,
    o.name AS organization_name, w.icon, w.created_by_user_id,
    wm.role, wm.page_root_id
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
  LEFT JOIN organizations o ON o.id = w.organization_id`;

class WorkspaceStore {
  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const [rows] = await rqlite<WorkspaceSummaryRow>([
      [`${WORKSPACE_SUMMARY_SELECT}
        WHERE wm.user_id = ?
        ORDER BY lower(w.name), w.created_at`, userId],
    ], "query");
    return (rows ?? []).map(summary);
  }

  async getForUser(workspaceId: string, userId: string): Promise<WorkspaceSummary | null> {
    const [rows] = await rqlite<WorkspaceSummaryRow>([
      [`${WORKSPACE_SUMMARY_SELECT}
        WHERE wm.workspace_id = ? AND wm.user_id = ?
        LIMIT 1`, workspaceId, userId],
    ], "query");
    return rows?.[0] ? summary(rows[0]) : null;
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<Schema.WorkspaceMember | null> {
    return db.workspaceMembers.find({
      workspace_id: workspaceId,
      user_id: userId,
    } as LookupValues<Schema.WorkspaceMember>);
  }

  async hasCreatedWorkspace(userId: string): Promise<boolean> {
    const [rows] = await rqlite<{ found: number }>([[
      `SELECT 1 AS found
        FROM workspaces
        WHERE created_by_user_id = ?
        LIMIT 1`,
      userId,
    ]], "query");
    return rows?.[0]?.found === 1;
  }

  async getAccessKey(keyHash: string): Promise<WorkspaceKeyRecord | null> {
    const [rows] = await rqlite<WorkspaceKeyRecord>([
      [`SELECT k.*, l.workspace_id, w.name AS workspace_name
        FROM workspace_access_keys k
        LEFT JOIN workspace_access_key_links l ON l.access_key_id = k.id
        LEFT JOIN workspaces w ON w.id = l.workspace_id
        WHERE k.key_hash = ?
        LIMIT 1`, keyHash],
    ], "query");
    return rows?.[0] ?? null;
  }

  async createWithKey(input: CreateWorkspaceProvision): Promise<boolean> {
    const validKey = `k.id = ? AND k.key_hash = ? AND k.purpose = 'create'
      AND lower(trim(k.issued_to_email)) = ?
      AND k.consumed_at IS NULL AND k.revoked_at IS NULL
      AND julianday(k.expires_at) > julianday('now')
      AND NOT EXISTS (
        SELECT 1 FROM workspace_access_key_links existing
        WHERE existing.access_key_id = k.id
      )`;
    const keyValues = [
      input.keyId,
      input.keyHash,
      input.issuedEmail,
    ];

    const results = await rqlite([
      [`INSERT INTO workspaces (
          id, name, data, organization_id, icon, created_by_user_id
        )
        SELECT ?, ?, ?, ?, ?, ?
        FROM workspace_access_keys k
        WHERE ${validKey}
          AND (
            (? IS NULL AND NOT EXISTS (
              SELECT 1 FROM workspaces owned
              WHERE owned.created_by_user_id = ?
            ))
            OR
            (? IS NOT NULL AND EXISTS (
              SELECT 1 FROM organization_members om
              WHERE om.organization_id = ? AND om.user_id = ?
                AND om.role = 'superadmin'
            ))
          )`,
        input.workspaceId, input.workspaceName, JSON.stringify({}), input.organizationId,
        input.workspaceIcon, input.ownerId, ...keyValues,
        input.organizationId, input.ownerId, input.organizationId,
        input.organizationId, input.ownerId],
      [`INSERT INTO pages (id, title, data, owner_id)
        SELECT ?, ?, ?, ?
        FROM workspace_access_keys k
        WHERE ${validKey}
          AND EXISTS (
            SELECT 1 FROM workspaces created
            WHERE created.id = ? AND created.created_by_user_id = ?
          )`,
        input.workspaceId, input.rootTitle, JSON.stringify({}), input.ownerId,
        ...keyValues, input.workspaceId, input.ownerId],
      [`INSERT INTO workspace_members (
          id, workspace_id, user_id, role, page_root_id
        )
        SELECT ?, ?, ?, 'superadmin', ?
        FROM workspace_access_keys k
        WHERE ${validKey}
          AND EXISTS (
            SELECT 1 FROM workspaces created
            WHERE created.id = ? AND created.created_by_user_id = ?
          )`,
        input.membershipId, input.workspaceId, input.ownerId, input.workspaceId,
        ...keyValues, input.workspaceId, input.ownerId],
      [`INSERT INTO workspace_access_key_links (id, access_key_id, workspace_id)
        SELECT ?, ?, ?
        FROM workspace_access_keys k
        WHERE ${validKey}
          AND EXISTS (
            SELECT 1 FROM workspaces created
            WHERE created.id = ? AND created.created_by_user_id = ?
          )`,
        input.keyLinkId, input.keyId, input.workspaceId,
        ...keyValues, input.workspaceId, input.ownerId],
      [`UPDATE workspace_access_keys
        SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            consumed_by_user_id = ?, consumed_as_name = ?,
            consumed_as_email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND key_hash = ? AND purpose = 'create'
          AND lower(trim(issued_to_email)) = ?
          AND consumed_at IS NULL AND revoked_at IS NULL
          AND julianday(expires_at) > julianday('now')
          AND EXISTS (
            SELECT 1 FROM workspaces created
            WHERE created.id = ? AND created.created_by_user_id = ?
          )`,
        input.ownerId, input.issuedName, input.issuedEmail,
        ...keyValues, input.workspaceId, input.ownerId],
    ], "execute", { transaction: true });

    return results.length === 5 && results.every(Boolean);
  }

  async joinWithKey(input: JoinWorkspaceProvision): Promise<boolean> {
    const validKey = `k.id = ? AND k.key_hash = ? AND k.purpose = 'join'
      AND lower(trim(k.issued_to_email)) = ?
      AND k.consumed_at IS NULL AND k.revoked_at IS NULL
      AND julianday(k.expires_at) > julianday('now')
      AND EXISTS (
        SELECT 1
        FROM workspace_access_key_links l
        JOIN workspaces linked_workspace ON linked_workspace.id = l.workspace_id
        WHERE l.access_key_id = k.id AND l.workspace_id = ?
      )`;
    const keyValues = [
      input.keyId,
      input.keyHash,
      input.issuedEmail,
      input.workspaceId,
    ];

    const results = await rqlite([
      [`INSERT INTO pages (id, title, data, owner_id)
        SELECT ?, ?, ?, ?
        FROM workspace_access_keys k
        WHERE ${validKey}`,
        input.pageRootId, input.rootTitle, JSON.stringify({}), input.ownerId, ...keyValues],
      [`INSERT INTO workspace_members (
          id, workspace_id, user_id, role, page_root_id
        )
        SELECT ?, ?, ?, 'member', ?
        FROM workspace_access_keys k
        WHERE ${validKey}`,
        input.membershipId, input.workspaceId, input.ownerId, input.pageRootId, ...keyValues],
      [`UPDATE workspace_access_keys
        SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            consumed_by_user_id = ?, consumed_as_name = ?,
            consumed_as_email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND key_hash = ? AND purpose = 'join'
          AND lower(trim(issued_to_email)) = ?
          AND consumed_at IS NULL AND revoked_at IS NULL
          AND julianday(expires_at) > julianday('now')
          AND EXISTS (
            SELECT 1
            FROM workspace_access_key_links l
            JOIN workspaces linked_workspace ON linked_workspace.id = l.workspace_id
            WHERE l.access_key_id = workspace_access_keys.id AND l.workspace_id = ?
          )`,
        input.ownerId, input.issuedName, input.issuedEmail, ...keyValues],
    ], "execute", { transaction: true });

    return results.length === 3 && results.every(Boolean);
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMemberSummary[]> {
    const [rows] = await rqlite<WorkspaceMemberRow>([
      [`SELECT u.id, u.name, u.email, wm.role, wm.page_root_id
        FROM workspace_members wm
        JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ?
        ORDER BY CASE wm.role WHEN 'superadmin' THEN 0 ELSE 1 END,
          lower(u.email)`, workspaceId],
    ], "query");
    return (rows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      pageRootId: row.page_root_id,
    }));
  }

  async updateMemberRole(
    workspaceId: string,
    actorUserId: string,
    userId: string,
    role: Schema.WorkspaceRole,
  ): Promise<boolean> {
    const [updated] = await rqlite([
      [`UPDATE workspace_members
        SET role = ?, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND user_id = ?
          AND EXISTS (
            SELECT 1
            FROM workspace_members actor
            WHERE actor.workspace_id = workspace_members.workspace_id
              AND actor.user_id = ? AND actor.role = 'superadmin'
          )
          AND (
            ? <> 'member'
            OR role <> 'superadmin'
            OR (
              SELECT COUNT(*)
              FROM workspace_members administrators
              WHERE administrators.workspace_id = workspace_members.workspace_id
                AND administrators.role = 'superadmin'
            ) > 1
        )`, role, workspaceId, userId, actorUserId, role],
    ], "execute", { transaction: true });

    return updated === true;
  }

  async issueAccessKey(
    key: Omit<
      Schema.WorkspaceAccessKey,
      "created_at" | "updated_at" | "consumed_as_name" | "consumed_as_email"
    >,
    workspaceId: string | null,
    linkId: string | null,
  ): Promise<boolean> {
    const keyColumns = `id, key_hash, key_hint, algorithm_version, issued_to_name,
      issued_to_email, purpose, expires_at, consumed_at,
      consumed_by_user_id, revoked_at`;
    const keyValues = [
      key.id, key.key_hash, key.key_hint, key.algorithm_version,
      key.issued_to_name, key.issued_to_email, key.purpose, key.expires_at,
    ];
    const statements: RqliteStatement[] = workspaceId && linkId
      ? [[
        `INSERT INTO workspace_access_keys (${keyColumns})
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL
          FROM workspaces
          WHERE id = ?`,
        ...keyValues, workspaceId,
      ]]
      : [[
        `INSERT INTO workspace_access_keys (
          id, key_hash, key_hint, algorithm_version, issued_to_name,
          issued_to_email, purpose, expires_at, consumed_at,
          consumed_by_user_id, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        ...keyValues,
      ]];

    if (workspaceId && linkId) {
      statements.push([
        `INSERT INTO workspace_access_key_links (id, access_key_id, workspace_id)
          SELECT ?, ?, ?
          FROM workspace_access_keys
          WHERE id = ?`,
        linkId, key.id, workspaceId, key.id,
      ]);
    }

    const results = await rqlite(statements, "execute", { transaction: true });
    return results.length === statements.length && results.every(Boolean);
  }
}

export default new WorkspaceStore();
