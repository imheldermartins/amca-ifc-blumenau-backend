import { ulid } from 'ulid';
import { rqlite } from '@db/shared';
import { fullPermissions, type AccessScope } from '@core/auth/permissions';

const tables = {
  organization: { table: 'organization_roles', foreignKey: 'organization_id' },
  workspace: { table: 'workspace_roles', foreignKey: 'workspace_id' },
  page: { table: 'page_roles', foreignKey: 'page_id' },
} as const;

/** Cria as roles obrigatórias de forma idempotente e sem espalhar SQL pelos fluxos. */
export class SystemRoleFactory {
  static defaultStatement(scope: AccessScope, scopeId: string, condition: SqlStatement = { text: '1', values: [] }): RqliteStatement {
    const target = tables[scope];
    return [
      `INSERT INTO ${target.table} (id, ${target.foreignKey}, name, roles, is_default, system_key)
       SELECT ?, ?, 'Default', ?, 1, 'default' WHERE ${condition.text}
       AND NOT EXISTS (SELECT 1 FROM ${target.table}
         WHERE ${target.foreignKey} = ? AND is_default = 1 AND deleted_at IS NULL)`,
      ulid(), scopeId, JSON.stringify(fullPermissions(scope)), ...condition.values, scopeId,
    ];
  }

  static workspaceGuestStatement(organizationId: string, condition: SqlStatement = { text: '1', values: [] }): RqliteStatement {
    return [
      `INSERT INTO organization_roles (id, organization_id, name, roles, is_default, system_key)
       SELECT ?, ?, 'Convidado de workspace', '{"read":["view"],"write":[]}', 0, 'workspace_guest'
       WHERE ${condition.text} AND NOT EXISTS (SELECT 1 FROM organization_roles
         WHERE organization_id = ? AND system_key = 'workspace_guest' AND deleted_at IS NULL)`,
      ulid(), organizationId, ...condition.values, organizationId,
    ];
  }

  static async ensureDefault(scope: AccessScope, scopeId: string): Promise<string | null> {
    const current = await this.find(scope, scopeId, 'default');
    if (current) return current;
    const statement = this.defaultStatement(scope, scopeId);
    const id = statement[1] as string;
    const [saved] = await rqlite([statement], 'execute', { transaction: true });
    return saved ? id : this.find(scope, scopeId, 'default');
  }

  static async ensureWorkspaceGuest(organizationId: string): Promise<string | null> {
    const current = await this.find('organization', organizationId, 'workspace_guest');
    if (current) return current;
    const statement = this.workspaceGuestStatement(organizationId);
    const id = statement[1] as string;
    const [saved] = await rqlite([statement], 'execute', { transaction: true });
    return saved ? id : this.find('organization', organizationId, 'workspace_guest');
  }

  static async find(scope: AccessScope, scopeId: string, systemKey: 'default' | 'workspace_guest') {
    const target = tables[scope];
    const [rows] = await rqlite<{ id: string }>([[
      `SELECT id FROM ${target.table} WHERE ${target.foreignKey} = ?
       AND system_key = ? AND deleted_at IS NULL LIMIT 1`, scopeId, systemKey,
    ]], 'query');
    return rows?.[0]?.id ?? null;
  }
}
