import { rqlite } from "@db/shared";
import db from "@models/index";
import type { Schema } from "@/models/schemas/index";

export interface OrganizationSummary {
  id: string;
  name: string;
  data: Record<string, unknown>;
  role: Schema.WorkspaceRole;
  workspaceCount: number;
}

export interface OrganizationWorkspaceUser {
  id: string;
  name: string | null;
  email: string;
  organizationRole: Schema.WorkspaceRole | null;
  workspaceRole: Schema.WorkspaceRole | null;
}

interface OrganizationWorkspaceUserRow {
  id: string;
  name: string | null;
  email: string;
  organization_role: Schema.WorkspaceRole | null;
  workspace_role: Schema.WorkspaceRole | null;
}

interface OrganizationSummaryRow {
  id: string;
  name: string;
  data: string | Record<string, unknown> | null;
  role: Schema.WorkspaceRole;
  workspace_count: number;
}

export interface CreateOrganizationProvision {
  organizationId: string;
  organizationName: string;
  membershipId: string;
  ownerId: string;
  workspaceId: string;
}

export interface AddOrganizationWorkspaceUserProvision {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  organizationMembershipId?: string;
  workspaceMembershipId?: string;
  pageRootId?: string;
  pageRootTitle?: string;
}

function parseData(value: OrganizationSummaryRow["data"]): Record<string, unknown> {
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

function summary(row: OrganizationSummaryRow): OrganizationSummary {
  return {
    id: row.id,
    name: row.name,
    data: parseData(row.data),
    role: row.role,
    workspaceCount: row.workspace_count,
  };
}

class OrganizationStore {
  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    const [rows] = await rqlite<OrganizationSummaryRow>([[
      `SELECT o.id, o.name, o.data, om.role,
        COUNT(w.id) AS workspace_count
      FROM organization_members om
      JOIN organizations o ON o.id = om.organization_id
      LEFT JOIN workspaces w ON w.organization_id = o.id
      WHERE om.user_id = ?
      GROUP BY o.id, o.name, o.data, om.role
      ORDER BY lower(o.name), o.created_at`,
      userId,
    ]], "query");
    return (rows ?? []).map(summary);
  }

  getMembership(organizationId: string, userId: string): Promise<Schema.OrganizationMember | null> {
    return db.organizationMembers.find({
      organization_id: organizationId,
      user_id: userId,
    } as LookupValues<Schema.OrganizationMember>);
  }

  async searchWorkspaceUsers(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
    prefixPattern: string,
    containsPattern: string,
  ): Promise<OrganizationWorkspaceUser[]> {
    const [rows] = await rqlite<OrganizationWorkspaceUserRow>([[
      `SELECT u.id, u.name, u.email,
        target_organization.role AS organization_role,
        target_workspace.role AS workspace_role
      FROM users u
      JOIN workspaces selected_workspace
        ON selected_workspace.id = ? AND selected_workspace.organization_id = ?
      JOIN organization_members actor_organization
        ON actor_organization.organization_id = selected_workspace.organization_id
        AND actor_organization.user_id = ? AND actor_organization.role = 'superadmin'
      JOIN workspace_members actor_workspace
        ON actor_workspace.workspace_id = selected_workspace.id
        AND actor_workspace.user_id = ? AND actor_workspace.role = 'superadmin'
      LEFT JOIN organization_members target_organization
        ON target_organization.organization_id = selected_workspace.organization_id
        AND target_organization.user_id = u.id
      LEFT JOIN workspace_members target_workspace
        ON target_workspace.workspace_id = selected_workspace.id
        AND target_workspace.user_id = u.id
      WHERE lower(COALESCE(u.name, '')) LIKE ? ESCAPE '\\'
        OR lower(u.email) LIKE ? ESCAPE '\\'
      ORDER BY CASE
          WHEN lower(COALESCE(u.name, '')) LIKE ? ESCAPE '\\'
            OR lower(u.email) LIKE ? ESCAPE '\\'
          THEN 0 ELSE 1
        END,
        lower(COALESCE(u.name, u.email)), lower(u.email)
      LIMIT 50`,
      workspaceId, organizationId, actorUserId, actorUserId,
      containsPattern, containsPattern, prefixPattern, prefixPattern,
    ]], "query");

    return (rows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      organizationRole: row.organization_role,
      workspaceRole: row.workspace_role,
    }));
  }

  async getWorkspaceUser(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<OrganizationWorkspaceUser | null> {
    const [rows] = await rqlite<OrganizationWorkspaceUserRow>([[
      `SELECT u.id, u.name, u.email,
        target_organization.role AS organization_role,
        target_workspace.role AS workspace_role
      FROM users u
      JOIN workspaces selected_workspace
        ON selected_workspace.id = ? AND selected_workspace.organization_id = ?
      JOIN organization_members actor_organization
        ON actor_organization.organization_id = selected_workspace.organization_id
        AND actor_organization.user_id = ? AND actor_organization.role = 'superadmin'
      JOIN workspace_members actor_workspace
        ON actor_workspace.workspace_id = selected_workspace.id
        AND actor_workspace.user_id = ? AND actor_workspace.role = 'superadmin'
      LEFT JOIN organization_members target_organization
        ON target_organization.organization_id = selected_workspace.organization_id
        AND target_organization.user_id = u.id
      LEFT JOIN workspace_members target_workspace
        ON target_workspace.workspace_id = selected_workspace.id
        AND target_workspace.user_id = u.id
      WHERE u.id = ?
      LIMIT 1`,
      workspaceId, organizationId, actorUserId, actorUserId, targetUserId,
    ]], "query");
    const row = rows?.[0];
    return row ? {
      id: row.id,
      name: row.name,
      email: row.email,
      organizationRole: row.organization_role,
      workspaceRole: row.workspace_role,
    } : null;
  }

  async addWorkspaceUser(input: AddOrganizationWorkspaceUserProvision): Promise<boolean> {
    const authorization = `EXISTS (
      SELECT 1
      FROM workspaces selected_workspace
      JOIN organization_members actor_organization
        ON actor_organization.organization_id = selected_workspace.organization_id
        AND actor_organization.user_id = ? AND actor_organization.role = 'superadmin'
      JOIN workspace_members actor_workspace
        ON actor_workspace.workspace_id = selected_workspace.id
        AND actor_workspace.user_id = ? AND actor_workspace.role = 'superadmin'
      WHERE selected_workspace.id = ? AND selected_workspace.organization_id = ?
    )`;
    const statements: RqliteStatement[] = [];

    if (input.organizationMembershipId) {
      statements.push([
        `INSERT INTO organization_members (id, organization_id, user_id, role)
        SELECT ?, ?, ?, 'member'
        FROM users target
        WHERE target.id = ? AND ${authorization}
          AND NOT EXISTS (
            SELECT 1 FROM organization_members existing
            WHERE existing.organization_id = ? AND existing.user_id = ?
          )`,
        input.organizationMembershipId, input.organizationId, input.targetUserId,
        input.targetUserId, input.actorUserId, input.actorUserId,
        input.workspaceId, input.organizationId,
        input.organizationId, input.targetUserId,
      ]);
    }

    if (input.workspaceMembershipId && input.pageRootId && input.pageRootTitle) {
      statements.push([
        `INSERT INTO pages (id, title, data, owner_id)
        SELECT ?, ?, ?, target.id
        FROM users target
        WHERE target.id = ? AND ${authorization}
          AND NOT EXISTS (
            SELECT 1 FROM workspace_members existing
            WHERE existing.workspace_id = ? AND existing.user_id = target.id
          )`,
        input.pageRootId, input.pageRootTitle, JSON.stringify({}), input.targetUserId,
        input.actorUserId, input.actorUserId, input.workspaceId, input.organizationId,
        input.workspaceId,
      ]);
      statements.push([
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, page_root_id)
        SELECT ?, ?, ?, 'member', ?
        FROM pages member_root
        WHERE member_root.id = ? AND member_root.owner_id = ? AND ${authorization}
          AND NOT EXISTS (
            SELECT 1 FROM workspace_members existing
            WHERE existing.workspace_id = ? AND existing.user_id = ?
          )`,
        input.workspaceMembershipId, input.workspaceId, input.targetUserId, input.pageRootId,
        input.pageRootId, input.targetUserId,
        input.actorUserId, input.actorUserId, input.workspaceId, input.organizationId,
        input.workspaceId, input.targetUserId,
      ]);
    }

    if (statements.length === 0) return false;
    const results = await rqlite(statements, "execute", { transaction: true });
    return results.length === statements.length && results.every(Boolean);
  }

  async createWithWorkspace(input: CreateOrganizationProvision): Promise<boolean> {
    const results = await rqlite([
      [`INSERT INTO organizations (id, name, data)
        SELECT ?, ?, ?
        FROM workspaces w
        JOIN workspace_members wm ON wm.workspace_id = w.id
        WHERE w.id = ? AND w.organization_id IS NULL
          AND wm.user_id = ? AND wm.role = 'superadmin'`,
        input.organizationId, input.organizationName, JSON.stringify({}),
        input.workspaceId, input.ownerId],
      [`INSERT INTO organization_members (
          id, organization_id, user_id, role
        )
        SELECT ?, ?, ?, 'superadmin'
        FROM organizations
        WHERE id = ?`,
        input.membershipId, input.organizationId, input.ownerId, input.organizationId],
      [`UPDATE workspaces
        SET organization_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id IS NULL
          AND EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = ? AND om.user_id = ?
              AND om.role = 'superadmin'
          )
          AND EXISTS (
            SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = workspaces.id AND wm.user_id = ?
              AND wm.role = 'superadmin'
          )`,
        input.organizationId, input.workspaceId, input.organizationId,
        input.ownerId, input.ownerId],
    ], "execute", { transaction: true });

    return results.length === 3 && results.every(Boolean);
  }

  async linkWorkspace(
    organizationId: string,
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    const [updated] = await rqlite([
      [`UPDATE workspaces
        SET organization_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id IS NULL
          AND EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = ? AND om.user_id = ?
              AND om.role = 'superadmin'
          )
          AND EXISTS (
            SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = workspaces.id AND wm.user_id = ?
              AND wm.role = 'superadmin'
          )`,
        organizationId, workspaceId, organizationId, userId, userId],
    ], "execute", { transaction: true });

    return updated === true;
  }
}

export default new OrganizationStore();
