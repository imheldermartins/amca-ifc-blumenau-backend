import { rqlite } from "@db/shared";
import type { Schema } from "@/models/schemas/index";
import { SystemRoleFactory } from "./system-role-factory.js";

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

/**
 * Fronteira transacional do cadastro. Usuário, workspace, root e membership
 * precisam nascer juntos: uma falha em qualquer INSERT reverte o lote inteiro
 * no rqlite.
 */
class AuthOnboardingStore {
  async findUserByCanonicalEmail(email: string): Promise<Schema.UserCredentials | null> {
    const [rows] = await rqlite<Schema.UserCredentials>([[
      `SELECT id, name, email, password_hash, token_version, email_verified_at, created_at, updated_at
        FROM users
        WHERE lower(trim(email)) = ?
        LIMIT 1`,
      email,
    ]], "query");
    return rows?.[0] ?? null;
  }

  async findUserById(id: string): Promise<Schema.UserCredentials | null> {
    const [rows] = await rqlite<Schema.UserCredentials>([[
      `SELECT id, name, email, password_hash, token_version, email_verified_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`, id,
    ]], 'query');
    return rows?.[0] ?? null;
  }

  async createPrivateWorkspace(input: PrivateWorkspaceProvision): Promise<boolean> {
    const workspaceCreated: SqlStatement = {
      text: "EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND created_by_user_id = ?)",
      values: [input.workspaceId, input.userId],
    };
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
      SystemRoleFactory.defaultStatement("workspace", input.workspaceId, workspaceCreated),
      SystemRoleFactory.defaultStatement("page", input.workspaceId, workspaceCreated),
      [`INSERT INTO workspace_members (
          id, workspace_id, user_id, workspace_member_role_id, page_root_id
        ) VALUES (?, ?, ?, NULL, ?)`,
        input.membershipId, input.workspaceId, input.userId, input.workspaceId],
    ], "execute", { transaction: true });

    return results.length === 6 && results.every(Boolean);
  }

}

export default new AuthOnboardingStore();
