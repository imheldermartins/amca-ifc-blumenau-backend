import { ulid } from "ulid";
import { rqlite } from "@db/shared";
import { accessGuard, SCOPE_TABLES } from "./scoped-access-store.js";
import { PERMISSION_CATALOG, ROLE_MANAGEMENT_PERMISSION, type AccessScope, type Permissions } from "@core/auth/permissions";

export interface RoleRecord {
  id: string; name: string; roles: Permissions; isDefault: boolean;
  systemKey: string | null; created_at: string; updated_at: string;
}
export interface MemberRecord {
  id: string; membershipId: string; name: string | null; email: string;
  roleId: string | null; roleName: string | null; permissions: Permissions;
}

export function decodeRoles(value: unknown): Permissions {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return { read: Array.isArray(parsed?.read) ? parsed.read : [], write: Array.isArray(parsed?.write) ? parsed.write : [] };
  } catch { return { read: [], write: [] }; }
}

/** Valida a delegação novamente no SQL; revogação concorrente não amplia acesso. */
export function delegationGuard(scope: AccessScope, scopeId: string, actorId: string, jsonExpression: string, jsonValues: unknown[] = []): SqlStatement {
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const kind of ["read", "write"] as const) {
    for (const action of PERMISSION_CATALOG[scope][kind]) {
      const permission = accessGuard(scope, scopeId, actorId, kind, action);
      clauses.push(`(NOT EXISTS (SELECT 1 FROM json_each(${jsonExpression}, '$.${kind}') WHERE value = ?) OR ${permission.text})`);
      values.push(...jsonValues, action, ...permission.values);
    }
  }
  return { text: clauses.join(" AND "), values };
}

export class RoleStore {
  async list(scope: AccessScope, scopeId: string): Promise<RoleRecord[]> {
    const [rows] = await rqlite<RoleRecord & { roles: unknown }>([[
      `SELECT id, name, roles, is_default AS isDefault, system_key AS systemKey, created_at, updated_at
       FROM ${scope}_roles WHERE ${scope}_id = ? AND deleted_at IS NULL
       ORDER BY is_default DESC, lower(name), id`, scopeId,
    ]], "query");
    return (rows ?? []).map((row) => ({ ...row, isDefault: Boolean(row.isDefault), roles: decodeRoles(row.roles) }));
  }

  async get(scope: AccessScope, scopeId: string, roleId: string): Promise<RoleRecord | null> {
    const [rows] = await rqlite<RoleRecord & { roles: unknown }>([[
      `SELECT id, name, roles, is_default AS isDefault, system_key AS systemKey, created_at, updated_at
       FROM ${scope}_roles WHERE ${scope}_id = ? AND id = ? AND deleted_at IS NULL`, scopeId, roleId,
    ]], "query");
    const row = rows?.[0];
    return row ? { ...row, isDefault: Boolean(row.isDefault), roles: decodeRoles(row.roles) } : null;
  }

  async save(scope: AccessScope, scopeId: string, actorId: string, input: { name: string; roles: Permissions; id?: string | undefined; expectedUpdatedAt?: string | undefined }): Promise<RoleRecord | null> {
    const id = input.id ?? ulid();
    const now = new Date().toISOString();
    const auth = accessGuard(scope, scopeId, actorId, "write", ROLE_MANAGEMENT_PERMISSION[scope]);
    const json = JSON.stringify(input.roles);
    const delegate = delegationGuard(scope, scopeId, actorId, "?", [json]);
    let statement: RqliteStatement;
    if (input.id) {
      const current = delegationGuard(scope, scopeId, actorId, `${scope}_roles.roles`);
      statement = [`UPDATE ${scope}_roles SET name = ?, roles = ?, updated_at = ?
        WHERE id = ? AND ${scope}_id = ? AND deleted_at IS NULL AND updated_at = ?
          AND ${auth.text} AND ${delegate.text} AND ${current.text}`,
        input.name, json, now, id, scopeId, input.expectedUpdatedAt ?? "", ...auth.values, ...delegate.values, ...current.values];
    } else {
      statement = [`INSERT INTO ${scope}_roles (id, ${scope}_id, name, roles, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE ${auth.text} AND ${delegate.text}`,
        id, scopeId, input.name, json, now, now, ...auth.values, ...delegate.values];
    }
    const [saved] = await rqlite([statement], "execute", { transaction: true });
    return saved ? this.get(scope, scopeId, id) : null;
  }

  async members(scope: AccessScope, scopeId: string): Promise<MemberRecord[]> {
    const [rows] = await rqlite<MemberRecord & { roles: unknown }>([[
      `SELECT u.id, m.id AS membershipId, u.name, u.email, role.id AS roleId, role.name AS roleName, role.roles
        FROM ${SCOPE_TABLES[scope].members} m JOIN users u ON u.id = m.user_id
        LEFT JOIN ${scope}_roles role ON role.id = m.${scope}_member_role_id AND role.${scope}_id = m.${scope}_id AND role.deleted_at IS NULL
        WHERE m.${scope}_id = ? AND m.deleted_at IS NULL
        UNION ALL
        SELECT u.id, u.id AS membershipId, u.name, u.email, NULL, NULL, NULL
        FROM ${SCOPE_TABLES[scope].resource} resource JOIN users u ON u.id = resource.${SCOPE_TABLES[scope].owner}
        WHERE resource.id = ? AND NOT EXISTS (
          SELECT 1 FROM ${SCOPE_TABLES[scope].members} m
          WHERE m.${scope}_id = resource.id AND m.user_id = u.id AND m.deleted_at IS NULL)
        ORDER BY 3, 4`, scopeId, scopeId,
    ]], "query");
    return (rows ?? []).map(({ roles, ...row }) => ({ ...row, permissions: decodeRoles(roles) }));
  }

  async assign(scope: AccessScope, scopeId: string, actorId: string, userId: string, roleId: string): Promise<boolean> {
    const table = SCOPE_TABLES[scope].members;
    const auth = accessGuard(scope, scopeId, actorId, "write", "promote_members");
    const owner = accessGuard(scope, scopeId, userId, "owner", "owner");
    const delegate = delegationGuard(scope, scopeId, actorId, "candidate.roles");
    const current = delegationGuard(scope, scopeId, actorId,
      `(SELECT r.roles FROM ${scope}_roles r WHERE r.id = ${table}.${scope}_member_role_id AND r.${scope}_id = ${table}.${scope}_id)`);
    const [saved] = await rqlite([[
      `UPDATE ${table} SET ${scope}_member_role_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE ${scope}_id = ? AND user_id = ? AND deleted_at IS NULL
          AND ${auth.text} AND NOT ${owner.text} AND ${current.text}
          AND EXISTS (SELECT 1 FROM ${scope}_roles candidate WHERE candidate.id = ? AND candidate.${scope}_id = ?
            AND candidate.deleted_at IS NULL AND ${delegate.text})`,
      roleId, scopeId, userId, ...auth.values, ...owner.values, ...current.values, roleId, scopeId, ...delegate.values,
    ]], "execute", { transaction: true });
    return saved === true;
  }

  async removeMember(scope: AccessScope, scopeId: string, actorId: string, userId: string): Promise<boolean> {
    const table = SCOPE_TABLES[scope].members;
    const auth = accessGuard(scope, scopeId, actorId, "write", "promote_members");
    const owner = accessGuard(scope, scopeId, userId, "owner", "owner");
    const current = delegationGuard(scope, scopeId, actorId,
      `(SELECT r.roles FROM ${scope}_roles r WHERE r.id = ${table}.${scope}_member_role_id AND r.${scope}_id = ${table}.${scope}_id)`);
    const [removed] = await rqlite([[
      `UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE ${scope}_id = ? AND user_id = ? AND deleted_at IS NULL
         AND ${auth.text} AND NOT ${owner.text} AND ${current.text}`,
      scopeId, userId, ...auth.values, ...owner.values, ...current.values,
    ]], "execute", { transaction: true });
    return removed === true;
  }

  /** Criação autorizada pelo fluxo pai (cadastro/convite/aceite), dentro da sua transação. */
  memberStatements(scope: AccessScope, scopeId: string, userId: string, roleId: string, membershipId: string, condition: SqlStatement): RqliteStatement[] {
    const statements: RqliteStatement[] = [];
    const rootId = ulid();
    if (scope === "workspace") {
      statements.push([`INSERT INTO pages (id, title, data, owner_id)
        SELECT ?, 'Base de dados', '{}', ? WHERE ${condition.text}`, rootId, userId, ...condition.values]);
    }
    statements.push([`INSERT INTO ${SCOPE_TABLES[scope].members} (
      id, ${scope}_id, user_id, ${scope}_member_role_id ${scope === "workspace" ? ', page_root_id' : ''})
      SELECT ?, ?, ?, ? ${scope === "workspace" ? ', ?' : ''} WHERE ${condition.text}`,
      membershipId, scopeId, userId, roleId, ...(scope === "workspace" ? [rootId] : []), ...condition.values]);
    return statements;
  }

  async addMember(scope: AccessScope, scopeId: string, actorId: string, userId: string, roleId: string): Promise<boolean> {
    const auth = accessGuard(scope, scopeId, actorId, "write", "add_members");
    const delegate = delegationGuard(scope, scopeId, actorId, "candidate.roles");
    const condition: SqlStatement = {
      text: `${auth.text} AND EXISTS (SELECT 1 FROM users WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM ${SCOPE_TABLES[scope].members}
          WHERE ${scope}_id = ? AND user_id = ? AND deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM ${scope}_roles candidate WHERE candidate.id = ? AND candidate.${scope}_id = ?
          AND candidate.deleted_at IS NULL AND ${delegate.text})`,
      values: [...auth.values, userId, scopeId, userId, roleId, scopeId, ...delegate.values],
    };
    const statements = this.memberStatements(scope, scopeId, userId, roleId, ulid(), condition);
    const results = await rqlite(statements, "execute", { transaction: true });
    return results.length === statements.length && results.every(Boolean);
  }

  async remove(scope: AccessScope, scopeId: string, actorId: string, roleId: string): Promise<boolean> {
    const auth = accessGuard(scope, scopeId, actorId, 'write', ROLE_MANAGEMENT_PERMISSION[scope]);
    const current = delegationGuard(scope, scopeId, actorId, `${scope}_roles.roles`);
    const [saved] = await rqlite([[
      `UPDATE ${scope}_roles SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND ${scope}_id = ? AND deleted_at IS NULL
         AND is_default = 0 AND system_key IS NULL AND ${auth.text} AND ${current.text}
         AND NOT EXISTS (SELECT 1 FROM ${SCOPE_TABLES[scope].members} member
           WHERE member.${scope}_member_role_id = ${scope}_roles.id AND member.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM access_invites invite WHERE invite.role_id = ${scope}_roles.id
           AND invite.scope_type = ? AND invite.scope_id = ? AND invite.status = 'pending' AND invite.deleted_at IS NULL)`,
      roleId, scopeId, ...auth.values, ...current.values, scope, scopeId,
    ]], 'execute', { transaction: true });
    return saved === true;
  }

  async listOrganizationWorkspaceRoles(workspaceId: string): Promise<Array<RoleRecord & {
    workspaceId: string; workspaceName: string | null;
  }>> {
    const [rows] = await rqlite<RoleRecord & { roles: unknown; workspaceId: string; workspaceName: string | null }>([[
      `SELECT role.id, role.name, role.roles, role.is_default AS isDefault, role.system_key AS systemKey,
        role.created_at, role.updated_at, source.id AS workspaceId, source.name AS workspaceName
       FROM workspaces current JOIN workspaces source ON source.organization_id = current.organization_id
       JOIN workspace_roles role ON role.workspace_id = source.id AND role.deleted_at IS NULL
       WHERE current.id = ? ORDER BY lower(source.name), role.is_default DESC, lower(role.name)`, workspaceId,
    ]], 'query');
    return (rows ?? []).map(({ roles: value, ...row }) => ({ ...row, isDefault: Boolean(row.isDefault), roles: decodeRoles(value) }));
  }

  async copyWorkspaceRole(workspaceId: string, sourceRoleId: string, actorId: string): Promise<RoleRecord | null> {
    const source = (await this.listOrganizationWorkspaceRoles(workspaceId)).find(role => role.id === sourceRoleId);
    if (!source || source.workspaceId === workspaceId) return null;
    return this.save('workspace', workspaceId, actorId, { name: source.name, roles: source.roles });
  }
}

export default new RoleStore();
