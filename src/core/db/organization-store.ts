import { rqlite } from '@db/shared';
import type { Schema } from '@/models/schemas/index';
import access, { accessGuard } from './scoped-access-store.js';
import { parseData } from './workspace-store.js';
import type { ScopeAccess } from '@core/auth/permissions';
import { SystemRoleFactory } from './system-role-factory.js';

export interface OrganizationSummary extends ScopeAccess { id: string; name: string; data: Record<string, unknown>; role: string | null; workspaceCount: number }
export interface OrganizationWorkspaceUser { id: string; name: string | null; email: string; organizationRole: string | null; workspaceRole: string | null }
export interface CreateOrganizationProvision { organizationId: string; organizationName: string; membershipId: string; ownerId: string }
class OrganizationStore {
  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    const [rows] = await rqlite<{ id: string }>([[`SELECT o.id FROM organizations o
      LEFT JOIN organization_members m ON m.organization_id = o.id AND m.user_id = ? AND m.deleted_at IS NULL
      WHERE o.owner_id = ? OR m.id IS NOT NULL ORDER BY lower(o.name)`, userId, userId]], 'query');
    const results = await Promise.all((rows ?? []).map(({ id }) => this.getForUser(id, userId)));
    return results.filter((row): row is OrganizationSummary => row !== null);
  }
  async getForUser(id: string, userId: string): Promise<OrganizationSummary | null> {
    const granted = await access.get('organization', id, userId);
    if (!granted?.permissions.read.includes('view')) return null;
    const catalog = granted.permissions.read.includes('workspaces');
    const [rows] = await rqlite<{ name: string; data: unknown; workspace_count: number }>([[`SELECT name, data,
      (SELECT COUNT(*) FROM workspaces WHERE organization_id = organizations.id AND ?) AS workspace_count
      FROM organizations WHERE id = ?`, catalog ? 1 : 0, id]], 'query');
    const row = rows?.[0];
    return row ? { ...granted, id, name: row.name, data: parseData(row.data), role: granted.roleId, workspaceCount: row.workspace_count } : null;
  }
  async getMembership(organizationId: string, userId: string) {
    const [rows] = await rqlite<Schema.OrganizationMember>([[
      `SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`,
      organizationId, userId,
    ]], 'query');
    return rows?.[0] ?? null;
  }
  async create(input: CreateOrganizationProvision): Promise<boolean> {
    const verified = `EXISTS (SELECT 1 FROM users WHERE id = ? AND email_verified_at IS NOT NULL)`;
    const created = `EXISTS (SELECT 1 FROM organizations WHERE id = ? AND owner_id = ?)`;
    const defaultRole = SystemRoleFactory.defaultStatement('organization', input.organizationId, {
      text: created, values: [input.organizationId, input.ownerId],
    });
    const defaultRoleId = defaultRole[1] as string;
    const results = await rqlite([
      [`INSERT INTO organizations (id, name, data, owner_id)
        SELECT ?, ?, '{}', ? WHERE ${verified}`,
        input.organizationId, input.organizationName, input.ownerId, input.ownerId],
      defaultRole,
      SystemRoleFactory.workspaceGuestStatement(input.organizationId, {
        text: created, values: [input.organizationId, input.ownerId],
      }),
      [`INSERT INTO organization_members (id, organization_id, user_id, organization_member_role_id)
        SELECT ?, ?, ?, ? WHERE ${created}`,
        input.membershipId, input.organizationId, input.ownerId, defaultRoleId,
        input.organizationId, input.ownerId],
    ], 'execute', { transaction: true });
    return results.length === 4 && results.every(Boolean);
  }
  async update(id: string, actorId: string, name: string): Promise<boolean> {
    const guard = accessGuard('organization', id, actorId, 'write', 'update');
    const [saved] = await rqlite([[`UPDATE organizations SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${guard.text}`,
      name, id, ...guard.values]], 'execute', { transaction: true });
    return saved === true;
  }
  async linkWorkspace(organizationId: string, workspaceId: string, actorId: string): Promise<boolean> {
    const organization = accessGuard('organization', organizationId, actorId, 'write', 'create');
    // Vincular muda quem é soberano. Somente o proprietário da workspace pode cedê-la.
    const workspace = accessGuard('workspace', workspaceId, actorId, 'owner', 'owner');
    const [saved] = await rqlite([[`UPDATE workspaces SET organization_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id IS NULL AND ${organization.text} AND ${workspace.text}`,
      organizationId, workspaceId, ...organization.values, ...workspace.values]], 'execute', { transaction: true });
    return saved === true;
  }
  async catalog(id: string, userId: string) {
    const guard = accessGuard('organization', id, userId, 'read', 'workspaces');
    const [rows] = await rqlite<{ id: string; name: string; icon: string }>([[`SELECT id, name, icon FROM workspaces
      WHERE organization_id = ? AND ${guard.text} ORDER BY lower(name)`, id, ...guard.values]], 'query');
    return Promise.all((rows ?? []).map(async (row) => {
      const grant = await access.get('workspace', row.id, userId);
      return { ...row, canEnter: grant?.permissions.read.includes('view') ?? false, isMember: grant?.isMember ?? false };
    }));
  }
}
export default new OrganizationStore();
