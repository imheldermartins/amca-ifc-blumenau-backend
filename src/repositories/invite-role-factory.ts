import { ulid } from 'ulid';
import { rqlite } from '@/db/client-db';
import type { AccessScope } from '@/services/auth/permissions';

/** Uma role por convite e escopo; vínculos auxiliares só permitem entrar no contexto. */
export class InviteRoleFactory {
  static key(inviteId: string): string { return `invite:${inviteId}`; }

  static statement(scope: AccessScope, scopeId: string, inviteId: string, id: string, sourceRoleId?: string): RqliteStatement {
    const table = `${scope}_roles`;
    const key = this.key(inviteId);
    const absent = `NOT EXISTS (SELECT 1 FROM ${table}
      WHERE ${scope}_id = ? AND system_key = ? AND deleted_at IS NULL)`;
    return sourceRoleId
      ? [`INSERT INTO ${table} (id, ${scope}_id, name, roles, is_default, system_key)
          SELECT ?, ?, substr('Convite · ' || source.name, 1, 120), source.roles, 0, ?
          FROM ${table} source WHERE source.id = ? AND source.${scope}_id = ?
            AND source.deleted_at IS NULL AND ${absent}`,
        id, scopeId, key, sourceRoleId, scopeId, scopeId, key]
      : [`INSERT INTO ${table} (id, ${scope}_id, name, roles, is_default, system_key)
          SELECT ?, ?, 'Acesso pelo convite', '{"read":["view"],"write":[]}', 0, ? WHERE ${absent}`,
        id, scopeId, key, scopeId, key];
  }

  static async ensure(scope: AccessScope, scopeId: string, inviteId: string, sourceRoleId?: string): Promise<string | null> {
    await rqlite([this.statement(scope, scopeId, inviteId, ulid(), sourceRoleId)], 'execute', { transaction: true });
    const [rows] = await rqlite<{ id: string }>([[
      `SELECT id FROM ${scope}_roles WHERE ${scope}_id = ? AND system_key = ? AND deleted_at IS NULL LIMIT 1`,
      scopeId, this.key(inviteId),
    ]], 'query');
    return rows?.[0]?.id ?? null;
  }
}
