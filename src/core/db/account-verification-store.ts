import { ulid } from 'ulid';
import { rqlite } from '@db/shared';
import { SystemRoleFactory } from './system-role-factory.js';

export interface VerificationContext {
  kind: 'native' | 'invite';
  returnTo?: string;
}

export interface VerificationRecord {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  inviteId: string | null;
  context: VerificationContext;
  expiresAt: string;
  lastSentAt: string;
}

export type StartVerificationResult =
  | { ok: true; verificationId: string; userId: string }
  | { ok: false; reason: 'already_verified' | 'too_soon' | 'failed' };

function parseContext(value: unknown): VerificationContext {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && ['native', 'invite'].includes((parsed as VerificationContext).kind)) {
      return parsed as VerificationContext;
    }
  } catch { /* resposta inválida é tratada como cadastro nativo */ }
  return { kind: 'native' };
}

/** Persistência transacional do estado pendente; o segredo nunca é salvo. */
class AccountVerificationStore {
  async findPendingByEmail(email: string): Promise<VerificationRecord | null> {
    const [rows] = await rqlite<Record<string, unknown>>([[
      `SELECT verification.id, verification.user_id AS userId, user.name, user.email,
        verification.invite_id AS inviteId, verification.context,
        verification.expires_at AS expiresAt, verification.last_sent_at AS lastSentAt
       FROM users user JOIN account_verifications verification ON verification.user_id = user.id
       WHERE lower(trim(user.email)) = ? AND user.email_verified_at IS NULL
         AND verification.consumed_at IS NULL AND verification.deleted_at IS NULL
       ORDER BY verification.created_at DESC LIMIT 1`, email,
    ]], 'query');
    const row = rows?.[0];
    return row ? {
      id: row.id as string,
      userId: row.userId as string,
      name: row.name as string | null,
      email: row.email as string,
      inviteId: row.inviteId as string | null,
      context: parseContext(row.context),
      expiresAt: row.expiresAt as string,
      lastSentAt: row.lastSentAt as string,
    } : null;
  }

  async start(input: {
    name: string | null;
    email: string;
    tokenHash: string;
    tokenHint: string;
    expiresAt: string;
    inviteId?: string | null;
    context: VerificationContext;
    bypassCooldown?: boolean;
  }): Promise<StartVerificationResult> {
    const [users] = await rqlite<{ id: string; email_verified_at: string | null }>([[
      `SELECT id, email_verified_at FROM users WHERE lower(trim(email)) = ? LIMIT 1`, input.email,
    ]], 'query');
    const current = users?.[0];
    if (current?.email_verified_at) return { ok: false, reason: 'already_verified' };

    const userId = current?.id ?? ulid();
    if (current && !input.bypassCooldown) {
      const [active] = await rqlite<{ retry_at: string }>([[
        `SELECT datetime(last_sent_at, '+60 seconds') AS retry_at FROM account_verifications
         WHERE user_id = ? AND consumed_at IS NULL AND deleted_at IS NULL
           AND julianday(last_sent_at, '+60 seconds') > julianday('now') LIMIT 1`, userId,
      ]], 'query');
      if (active?.length) return { ok: false, reason: 'too_soon' };
    }

    const verificationId = ulid();
    const statements: RqliteStatement[] = [];
    if (!current) {
      statements.push([
        `INSERT INTO users (id, name, email, password_hash, token_version, email_verified_at)
         VALUES (?, ?, ?, NULL, 0, NULL)`, userId, input.name, input.email,
      ]);
    } else if (input.name) {
      statements.push([
        `UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND email_verified_at IS NULL`, input.name, userId,
      ]);
    }
    statements.push(
      [`UPDATE account_verifications SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND consumed_at IS NULL AND deleted_at IS NULL`, userId],
      [`INSERT INTO account_verifications
        (id, user_id, token_hash, token_hint, invite_id, context, expires_at, last_sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, verificationId, userId,
        input.tokenHash, input.tokenHint, input.inviteId ?? null, JSON.stringify(input.context), input.expiresAt],
    );
    const results = await rqlite(statements, 'execute', { transaction: true });
    return results.at(-1) ? { ok: true, verificationId, userId } : { ok: false, reason: 'failed' };
  }

  async preview(tokenHash: string): Promise<VerificationRecord | null> {
    const [rows] = await rqlite<Record<string, unknown>>([[
      `SELECT verification.id, verification.user_id AS userId, user.name, user.email,
        verification.invite_id AS inviteId, verification.context,
        verification.expires_at AS expiresAt, verification.last_sent_at AS lastSentAt
       FROM account_verifications verification JOIN users user ON user.id = verification.user_id
       WHERE verification.token_hash = ? AND verification.consumed_at IS NULL
         AND verification.deleted_at IS NULL AND user.email_verified_at IS NULL
         AND julianday(verification.expires_at) > julianday('now') LIMIT 1`, tokenHash,
    ]], 'query');
    const row = rows?.[0];
    return row ? {
      id: row.id as string,
      userId: row.userId as string,
      name: row.name as string | null,
      email: row.email as string,
      inviteId: row.inviteId as string | null,
      context: parseContext(row.context),
      expiresAt: row.expiresAt as string,
      lastSentAt: row.lastSentAt as string,
    } : null;
  }

  async complete(input: {
    tokenHash: string;
    passwordHash: string;
    name: string | null;
    workspaceId: string;
    membershipId: string;
  }): Promise<{ userId: string; workspaceId: string; inviteId: string | null } | null> {
    const verification = await this.preview(input.tokenHash);
    if (!verification) return null;
    const workspaceName = `Area de Trabalho do ${(input.name || verification.name || 'usuário').trim().split(/\s+/)[0]}`;
    const canComplete: SqlStatement = {
      text: `EXISTS (SELECT 1 FROM account_verifications verification
        JOIN users user ON user.id = verification.user_id
        WHERE verification.id = ? AND verification.token_hash = ?
          AND verification.consumed_at IS NULL AND verification.deleted_at IS NULL
          AND user.email_verified_at IS NULL
          AND julianday(verification.expires_at) > julianday('now'))`,
      values: [verification.id, input.tokenHash],
    };
    const workspaceDefault = SystemRoleFactory.defaultStatement('workspace', input.workspaceId, {
      text: `EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND created_by_user_id = ?)`,
      values: [input.workspaceId, verification.userId],
    });
    const workspaceRoleId = workspaceDefault[1] as string;
    const pageDefault = SystemRoleFactory.defaultStatement('page', input.workspaceId, {
      text: `EXISTS (SELECT 1 FROM pages WHERE id = ? AND owner_id = ?)`,
      values: [input.workspaceId, verification.userId],
    });
    const statements: RqliteStatement[] = [
      [`UPDATE users SET name = COALESCE(?, name), password_hash = ?,
        email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND ${canComplete.text}`, input.name, input.passwordHash,
        verification.userId, ...canComplete.values],
      [`INSERT INTO workspaces (id, name, data, organization_id, icon, created_by_user_id)
        SELECT ?, ?, '{}', NULL, 'lucide:boxes', ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND email_verified_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM workspaces WHERE created_by_user_id = ?)`,
        input.workspaceId, workspaceName, verification.userId, verification.userId, verification.userId],
      [`INSERT INTO pages (id, title, data, owner_id)
        SELECT ?, ?, '{}', ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND created_by_user_id = ?)`,
        input.workspaceId, workspaceName, verification.userId, input.workspaceId, verification.userId],
      workspaceDefault,
      pageDefault,
      [`INSERT INTO workspace_members
        (id, workspace_id, user_id, workspace_member_role_id, page_root_id)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND created_by_user_id = ?)
          AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND deleted_at IS NULL)`,
        input.membershipId, input.workspaceId, verification.userId, workspaceRoleId, input.workspaceId,
        input.workspaceId, verification.userId, input.workspaceId, verification.userId],
    ];
    statements.push([
      `UPDATE account_verifications SET consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND token_hash = ? AND consumed_at IS NULL AND deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND email_verified_at IS NOT NULL)
         AND EXISTS (SELECT 1 FROM workspaces WHERE created_by_user_id = ?)`,
      verification.id, input.tokenHash, verification.userId, verification.userId,
    ]);
    await rqlite(statements, 'execute', { transaction: true });

    const [completed] = await rqlite<{ workspaceId: string }>([[
      `SELECT workspace.id AS workspaceId FROM account_verifications verification
       JOIN workspaces workspace ON workspace.created_by_user_id = verification.user_id
       WHERE verification.id = ? AND verification.consumed_at IS NOT NULL
       ORDER BY workspace.created_at LIMIT 1`, verification.id,
    ]], 'query');
    const row = completed?.[0];
    return row ? { userId: verification.userId, workspaceId: row.workspaceId, inviteId: verification.inviteId } : null;
  }
}

export default new AccountVerificationStore();
