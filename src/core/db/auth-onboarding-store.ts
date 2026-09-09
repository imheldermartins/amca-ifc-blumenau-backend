import { rqlite } from "@db/shared";
import type { Schema } from "@/models/schemas/index";

export interface PrivateWorkspaceProvision {
  userId: string;
  userName: string;
  userEmail: string;
  passwordHash: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string;
  membershipId: string;
}

export interface KeyedWorkspaceProvision extends PrivateWorkspaceProvision {
  keyId: string;
  keyHash: string;
  keyAlgorithm: string;
  keyLinkId: string;
}

/**
 * Fronteira transacional do cadastro. Usuário, workspace, root e membership
 * precisam nascer juntos: uma falha em qualquer INSERT reverte o lote inteiro
 * no rqlite.
 */
class AuthOnboardingStore {
  async findUserByCanonicalEmail(email: string): Promise<Schema.UserCredentials | null> {
    const [rows] = await rqlite<Schema.UserCredentials>([[
      `SELECT id, name, email, password_hash, token_version, created_at, updated_at
        FROM users
        WHERE lower(trim(email)) = ?
        LIMIT 1`,
      email,
    ]], "query");
    return rows?.[0] ?? null;
  }

  async createPrivateWorkspace(input: PrivateWorkspaceProvision): Promise<boolean> {
    const results = await rqlite([
      [`INSERT INTO users (id, name, email, password_hash, token_version)
        VALUES (?, ?, ?, ?, 0)`,
        input.userId, input.userName, input.userEmail, input.passwordHash],
      [`INSERT INTO workspaces (
          id, name, data, organization_id, icon, created_by_user_id
        ) VALUES (?, ?, ?, NULL, ?, ?)`,
        input.workspaceId, input.workspaceName, JSON.stringify({}),
        input.workspaceIcon, input.userId],
      [`INSERT INTO pages (id, title, data, owner_id)
        VALUES (?, ?, ?, ?)`,
        input.workspaceId, input.workspaceName, JSON.stringify({}), input.userId],
      [`INSERT INTO workspace_members (
          id, workspace_id, user_id, role, page_root_id
        ) VALUES (?, ?, ?, 'superadmin', ?)`,
        input.membershipId, input.workspaceId, input.userId, input.workspaceId],
    ], "execute", { transaction: true });

    return results.length === 4 && results.every(Boolean);
  }

  /**
   * Variante pública autorizada por chave `create`. Todos os INSERTs repetem
   * a condição da chave para que credencial inválida seja somente um lote de
   * no-ops; em corrida, só a transação que consumir primeiro pode concluir.
   * Nome/e-mail emitidos não são sobrescritos: são evidência histórica.
   */
  async createWorkspaceWithKey(input: KeyedWorkspaceProvision): Promise<boolean> {
    const validKey = `k.id = ? AND k.key_hash = ?
      AND k.algorithm_version = ? AND k.purpose = 'create'
      AND k.consumed_at IS NULL AND k.revoked_at IS NULL
      AND julianday(k.expires_at) > julianday('now')
      AND NOT EXISTS (
        SELECT 1 FROM workspace_access_key_links existing
        WHERE existing.access_key_id = k.id
      )`;
    const keyValues = [input.keyId, input.keyHash, input.keyAlgorithm];

    const results = await rqlite([
      [`INSERT INTO users (id, name, email, password_hash, token_version)
        SELECT ?, ?, ?, ?, 0
        FROM workspace_access_keys k
        WHERE ${validKey}`,
        input.userId, input.userName, input.userEmail, input.passwordHash, ...keyValues],
      [`INSERT INTO workspaces (
          id, name, data, organization_id, icon, created_by_user_id
        )
        SELECT ?, ?, ?, NULL, ?, ?
        FROM workspace_access_keys k
        WHERE ${validKey}`,
        input.workspaceId, input.workspaceName, JSON.stringify({}),
        input.workspaceIcon, input.userId, ...keyValues],
      [`INSERT INTO pages (id, title, data, owner_id)
        SELECT ?, ?, ?, ?
        FROM workspace_access_keys k
        WHERE ${validKey}`,
        input.workspaceId, input.workspaceName, JSON.stringify({}), input.userId,
        ...keyValues],
      [`INSERT INTO workspace_members (
          id, workspace_id, user_id, role, page_root_id
        )
        SELECT ?, ?, ?, 'superadmin', ?
        FROM workspace_access_keys k
        WHERE ${validKey}`,
        input.membershipId, input.workspaceId, input.userId, input.workspaceId,
        ...keyValues],
      [`INSERT INTO workspace_access_key_links (id, access_key_id, workspace_id)
        SELECT ?, ?, ?
        FROM workspace_access_keys k
        WHERE ${validKey}`,
        input.keyLinkId, input.keyId, input.workspaceId, ...keyValues],
      [`UPDATE workspace_access_keys
        SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            consumed_by_user_id = ?, consumed_as_name = ?,
            consumed_as_email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND key_hash = ? AND algorithm_version = ?
          AND purpose = 'create'
          AND consumed_at IS NULL AND revoked_at IS NULL
          AND julianday(expires_at) > julianday('now')
          AND EXISTS (
            SELECT 1 FROM workspace_access_key_links linked
            WHERE linked.access_key_id = workspace_access_keys.id
              AND linked.workspace_id = ?
          )`,
        input.userId, input.userName, input.userEmail, ...keyValues, input.workspaceId],
    ], "execute", { transaction: true });

    return results.length === 6 && results.every(Boolean);
  }
}

export default new AuthOnboardingStore();
