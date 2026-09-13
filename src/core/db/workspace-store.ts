import { ulid } from 'ulid';
import { rqlite } from '@db/shared';
import type { Schema } from '@/models/schemas/index';
import access, { accessGuard } from './scoped-access-store.js';
import roles from './role-store.js';
import type { ScopeAccess } from '@core/auth/permissions';
import { SystemRoleFactory } from './system-role-factory.js';

export interface WorkspaceSummary extends ScopeAccess {
  id: string; name: string | null; data: Record<string, unknown>; organizationId: string | null;
  organizationName: string | null; isPersonal: boolean; icon: string; createdByUserId: string | null;
  pageRootId: string; role: string | null;
}
export interface WorkspaceMemberSummary { id: string; name: string | null; email: string; role: string | null; pageRootId: string; roleId: string | null; roleName: string | null }
export interface CreateWorkspaceProvision {
  workspaceId: string; workspaceName: string; workspaceIcon: string; organizationId: string;
  ownerId: string; rootTitle: string; membershipId: string;
}
export function parseData(value: unknown): Record<string, unknown> {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

class WorkspaceStore {
  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const [rows] = await rqlite<{ id: string }>([[`SELECT DISTINCT w.id FROM workspaces w
      LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ? AND m.deleted_at IS NULL
      LEFT JOIN organizations o ON o.id = w.organization_id
      LEFT JOIN organization_members om ON om.organization_id = o.id AND om.user_id = ? AND om.deleted_at IS NULL
      WHERE m.id IS NOT NULL OR w.created_by_user_id = ? OR o.owner_id = ? OR om.id IS NOT NULL
      ORDER BY lower(w.name), w.created_at`, userId, userId, userId, userId]], 'query');
    const result = await Promise.all((rows ?? []).map(({ id }) => this.getForUser(id, userId)));
    return result.filter((row): row is WorkspaceSummary => row !== null);
  }
  async getForUser(workspaceId: string, userId: string): Promise<WorkspaceSummary | null> {
    const allowed = await access.get('workspace', workspaceId, userId);
    if (!allowed?.permissions.read.includes('view')) return null;
    const [rows] = await rqlite<Record<string, unknown>>([[
      `SELECT w.*, o.name AS organization_name, COALESCE(m.page_root_id, w.id) AS page_root_id
       FROM workspaces w LEFT JOIN organizations o ON o.id = w.organization_id
       LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ? AND m.deleted_at IS NULL
       WHERE w.id = ?`, userId, workspaceId,
    ]], 'query');
    const row = rows?.[0];
    return row ? { ...allowed, id: workspaceId, name: row.name as string | null, data: parseData(row.data),
      organizationId: row.organization_id as string | null, organizationName: row.organization_name as string | null,
      isPersonal: row.organization_id == null,
      icon: row.icon as string || 'lucide:boxes', createdByUserId: row.created_by_user_id as string | null,
      role: allowed.roleId, pageRootId: row.page_root_id as string } : null;
  }
  async getMembership(workspaceId: string, userId: string): Promise<Schema.WorkspaceMember | null> {
    const [rows] = await rqlite<Schema.WorkspaceMember>([[
      `SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`,
      workspaceId, userId,
    ]], 'query');
    return rows?.[0] ?? null;
  }
  async createInOrganization(input: CreateWorkspaceProvision): Promise<boolean> {
    const authorization = accessGuard('organization', input.organizationId, input.ownerId, 'write', 'create');
    const created = `EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND created_by_user_id = ?)`;
    const statements: RqliteStatement[] = [
      [`INSERT INTO workspaces (id, name, data, organization_id, icon, created_by_user_id)
        SELECT ?, ?, '{}', ?, ?, ? WHERE ${authorization.text}`, input.workspaceId, input.workspaceName,
        input.organizationId, input.workspaceIcon, input.ownerId, ...authorization.values],
      [`INSERT INTO pages (id, title, data, owner_id) SELECT ?, ?, '{}', ? WHERE ${created}`,
        input.workspaceId, input.rootTitle, input.ownerId, input.workspaceId, input.ownerId],
      SystemRoleFactory.defaultStatement('workspace', input.workspaceId, {
        text: created, values: [input.workspaceId, input.ownerId],
      }),
      SystemRoleFactory.defaultStatement('page', input.workspaceId, {
        text: created, values: [input.workspaceId, input.ownerId],
      }),
      [`INSERT INTO workspace_members (id, workspace_id, user_id, workspace_member_role_id, page_root_id)
        SELECT ?, ?, ?, NULL, ? WHERE ${created}`, input.membershipId, input.workspaceId, input.ownerId,
        input.workspaceId, input.workspaceId, input.ownerId],
    ];
    const results = await rqlite(statements, 'execute', { transaction: true });
    return results.length === statements.length && results.every(Boolean);
  }
  async listMembers(workspaceId: string): Promise<WorkspaceMemberSummary[]> {
    const [rows] = await rqlite<WorkspaceMemberSummary>([[`SELECT u.id, u.name, u.email,
      r.id AS role, r.id AS roleId, r.name AS roleName, m.page_root_id AS pageRootId
      FROM workspace_members m JOIN users u ON u.id = m.user_id
      LEFT JOIN workspace_roles r ON r.id = m.workspace_member_role_id AND r.workspace_id = m.workspace_id
      WHERE m.workspace_id = ? AND m.deleted_at IS NULL ORDER BY lower(u.email)`, workspaceId]], 'query');
    return rows ?? [];
  }
  updateMemberRole(workspaceId: string, actorId: string, userId: string, roleId: string) {
    return roles.assign('workspace', workspaceId, actorId, userId, roleId);
  }
  async updateSettings(workspaceId: string, actorId: string, input: { name?: string | null; icon?: string }) {
    const guard = accessGuard('workspace', workspaceId, actorId, 'write', 'update');
    const [saved] = await rqlite([[`UPDATE workspaces SET name = COALESCE(?, name), icon = COALESCE(?, icon),
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${guard.text}`,
      input.name ?? null, input.icon ?? null, workspaceId, ...guard.values]], 'execute', { transaction: true });
    return saved === true;
  }
}
export default new WorkspaceStore();
