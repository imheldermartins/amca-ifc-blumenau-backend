import { ulid } from 'ulid';
import { rqlite } from '@db/shared';
import { SCOPE_TABLES } from './scoped-access-store.js';
import { SystemRoleFactory } from './system-role-factory.js';
import type { AccessScope } from '@core/auth/permissions';

export interface InviteRecord {
  id: string;
  scopeType: AccessScope;
  scopeId: string;
  scopeName: string;
  roleId: string;
  roleName: string;
  recipientEmail: string | null;
  authorId: string;
  authorName: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired';
  expiresAt: string | null;
  acceptanceLimit: number | null;
  acceptanceCount: number;
  notifiedAt: string | null;
  createdAt: string;
}

interface ScopeContext {
  workspaceId: string | null;
  organizationId: string | null;
}

const scopeNameExpression = `CASE invite.scope_type
  WHEN 'organization' THEN (SELECT name FROM organizations WHERE id = invite.scope_id)
  WHEN 'workspace' THEN (SELECT name FROM workspaces WHERE id = invite.scope_id)
  ELSE (SELECT COALESCE(title, 'Página sem título') FROM pages WHERE id = invite.scope_id)
END`;
const roleNameExpression = `CASE invite.scope_type
  WHEN 'organization' THEN (SELECT name FROM organization_roles WHERE id = invite.role_id AND organization_id = invite.scope_id)
  WHEN 'workspace' THEN (SELECT name FROM workspace_roles WHERE id = invite.role_id AND workspace_id = invite.scope_id)
  ELSE (SELECT name FROM page_roles WHERE id = invite.role_id AND page_id = invite.scope_id)
END`;

function mapInvite(row: Record<string, unknown>): InviteRecord {
  return {
    id: row.id as string,
    scopeType: row.scopeType as AccessScope,
    scopeId: row.scopeId as string,
    scopeName: row.scopeName as string,
    roleId: row.roleId as string,
    roleName: row.roleName as string,
    recipientEmail: row.recipientEmail as string | null,
    authorId: row.authorId as string,
    authorName: row.authorName as string,
    status: row.status as InviteRecord['status'],
    expiresAt: row.expiresAt as string | null,
    acceptanceLimit: row.acceptanceLimit as number | null,
    acceptanceCount: Number(row.acceptanceCount ?? 0),
    notifiedAt: row.notifiedAt as string | null,
    createdAt: row.createdAt as string,
  };
}

/** Convites e provisionamento entre escopos vivem juntos para o aceite ser atômico. */
class AccessInviteStore {
  async expireStale(): Promise<void> {
    await rqlite([`UPDATE access_invites SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'pending' AND deleted_at IS NULL AND (
        (expires_at IS NOT NULL AND julianday(expires_at) <= julianday('now')) OR
        (acceptance_limit IS NOT NULL AND acceptance_count >= acceptance_limit))`], 'execute');
  }

  async create(input: {
    id: string; tokenHash: string; tokenHint: string; scope: AccessScope; scopeId: string;
    roleId: string; recipientEmail: string | null; authorId: string; expiresAt: string | null;
    acceptanceLimit: number | null;
  }): Promise<boolean> {
    const [saved] = await rqlite([[
      `INSERT INTO access_invites
       (id, token_hash, token_hint, scope_type, scope_id, role_id, recipient_email,
        author_id, status, expires_at, acceptance_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      input.id, input.tokenHash, input.tokenHint, input.scope, input.scopeId, input.roleId,
      input.recipientEmail, input.authorId, input.expiresAt, input.acceptanceLimit,
    ]], 'execute', { transaction: true });
    return saved === true;
  }

  async getById(id: string): Promise<InviteRecord | null> {
    await this.expireStale();
    const [rows] = await rqlite<Record<string, unknown>>([[
      `SELECT invite.id, invite.scope_type AS scopeType, invite.scope_id AS scopeId,
        ${scopeNameExpression} AS scopeName, invite.role_id AS roleId,
        ${roleNameExpression} AS roleName, invite.recipient_email AS recipientEmail,
        invite.author_id AS authorId, COALESCE(author.name, author.email) AS authorName,
        invite.status, invite.expires_at AS expiresAt, invite.acceptance_limit AS acceptanceLimit,
        invite.acceptance_count AS acceptanceCount, invite.notified_at AS notifiedAt,
        invite.created_at AS createdAt
       FROM access_invites invite JOIN users author ON author.id = invite.author_id
       WHERE invite.id = ? LIMIT 1`, id,
    ]], 'query');
    return rows?.[0] ? mapInvite(rows[0]) : null;
  }

  async getByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    await this.expireStale();
    const [rows] = await rqlite<{ id: string }>([[
      `SELECT id FROM access_invites WHERE token_hash = ? AND deleted_at IS NULL LIMIT 1`, tokenHash,
    ]], 'query');
    return rows?.[0] ? this.getById(rows[0].id) : null;
  }

  async list(scope: AccessScope, scopeId: string): Promise<InviteRecord[]> {
    await this.expireStale();
    const [rows] = await rqlite<Record<string, unknown>>([[
      `SELECT invite.id, invite.scope_type AS scopeType, invite.scope_id AS scopeId,
        ${scopeNameExpression} AS scopeName, invite.role_id AS roleId,
        ${roleNameExpression} AS roleName, invite.recipient_email AS recipientEmail,
        invite.author_id AS authorId, COALESCE(author.name, author.email) AS authorName,
        invite.status, invite.expires_at AS expiresAt, invite.acceptance_limit AS acceptanceLimit,
        invite.acceptance_count AS acceptanceCount, invite.notified_at AS notifiedAt,
        invite.created_at AS createdAt
       FROM access_invites invite JOIN users author ON author.id = invite.author_id
       WHERE invite.scope_type = ? AND invite.scope_id = ?
       ORDER BY invite.created_at DESC`, scope, scopeId,
    ]], 'query');
    return (rows ?? []).map(mapInvite);
  }

  async markNotified(id: string): Promise<void> {
    await rqlite([[
      `UPDATE access_invites SET notified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`, id,
    ]], 'execute');
  }

  async remove(id: string, scope: AccessScope, scopeId: string): Promise<boolean> {
    const [saved] = await rqlite([[
      `UPDATE access_invites SET status = 'expired', deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND scope_type = ? AND scope_id = ?
        AND deleted_at IS NULL`, id, scope, scopeId,
    ]], 'execute', { transaction: true });
    return saved === true;
  }

  async exactEmail(email: string, scope: AccessScope, scopeId: string): Promise<{
    found: boolean; user: { id: string; name: string | null; email: string; verified: boolean } | null;
    isMember: boolean;
  }> {
    const memberTable = SCOPE_TABLES[scope].members;
    const [rows] = await rqlite<Record<string, unknown>>([[
      `SELECT user.id, user.name, user.email, user.email_verified_at IS NOT NULL AS verified,
        EXISTS (SELECT 1 FROM ${memberTable} member WHERE member.${scope}_id = ?
          AND member.user_id = user.id AND member.deleted_at IS NULL) AS isMember
       FROM users user WHERE lower(trim(user.email)) = ? LIMIT 1`, scopeId, email,
    ]], 'query');
    const row = rows?.[0];
    return row ? {
      found: true,
      user: { id: row.id as string, name: row.name as string | null, email: row.email as string, verified: row.verified === 1 },
      isMember: row.isMember === 1,
    } : { found: false, user: null, isMember: false };
  }

  async acceptByTokenHash(tokenHash: string, userId: string): Promise<boolean> {
    const invite = await this.getByTokenHash(tokenHash);
    return invite ? this.acceptById(invite.id, userId) : false;
  }

  async acceptById(inviteId: string, userId: string): Promise<boolean> {
    await this.expireStale();
    const invite = await this.getById(inviteId);
    if (!invite || invite.status !== 'pending') return false;
    const context = await this.scopeContext(invite.scopeType, invite.scopeId);
    const roleId = invite.roleId || await SystemRoleFactory.ensureDefault(invite.scopeType, invite.scopeId);
    if (!roleId) return false;
    const [selectedRoles] = await rqlite<{ id: string }>([[
      `SELECT id FROM ${invite.scopeType}_roles WHERE id = ? AND ${invite.scopeType}_id = ?
       AND deleted_at IS NULL LIMIT 1`, roleId, invite.scopeId,
    ]], 'query');
    if (!selectedRoles?.length) return false;
    const workspaceDefault = context.workspaceId
      ? await SystemRoleFactory.ensureDefault('workspace', context.workspaceId)
      : null;
    const organizationGuest = context.organizationId
      ? await SystemRoleFactory.ensureWorkspaceGuest(context.organizationId)
      : null;
    if (context.workspaceId && !workspaceDefault) return false;
    if (context.organizationId && !organizationGuest) return false;

    const acceptanceId = ulid();
    const valid: SqlStatement = {
      text: `EXISTS (SELECT 1 FROM access_invites invite JOIN users user ON user.id = ?
        WHERE invite.id = ? AND invite.status = 'pending' AND invite.deleted_at IS NULL
          AND user.email_verified_at IS NOT NULL
          AND (invite.recipient_email IS NULL OR lower(trim(invite.recipient_email)) = lower(trim(user.email)))
          AND (invite.expires_at IS NULL OR julianday(invite.expires_at) > julianday('now'))
          AND (invite.acceptance_limit IS NULL OR invite.acceptance_count < invite.acceptance_limit)
          AND NOT EXISTS (SELECT 1 FROM access_invite_acceptances acceptance
            WHERE acceptance.invite_id = invite.id AND acceptance.user_id = user.id))`,
      values: [userId, inviteId],
    };
    const statements: RqliteStatement[] = [];
    if (context.organizationId && organizationGuest) {
      statements.push([
        `INSERT INTO organization_members (id, organization_id, user_id, organization_member_role_id)
         SELECT ?, ?, ?, ? WHERE ${valid.text}
           AND NOT EXISTS (SELECT 1 FROM organization_members
             WHERE organization_id = ? AND user_id = ? AND deleted_at IS NULL)`,
        ulid(), context.organizationId, userId, organizationGuest, ...valid.values,
        context.organizationId, userId,
      ]);
    }
    if (context.workspaceId && workspaceDefault) {
      const rootId = ulid();
      statements.push(
        [`INSERT INTO pages (id, title, data, owner_id)
          SELECT ?, 'Base de dados', '{}', ? WHERE ${valid.text}
            AND NOT EXISTS (SELECT 1 FROM workspace_members
              WHERE workspace_id = ? AND user_id = ? AND deleted_at IS NULL)`,
          rootId, userId, ...valid.values, context.workspaceId, userId],
        [`INSERT INTO workspace_members
          (id, workspace_id, user_id, workspace_member_role_id, page_root_id)
          SELECT ?, ?, ?, ?, ? WHERE ${valid.text}
            AND NOT EXISTS (SELECT 1 FROM workspace_members
              WHERE workspace_id = ? AND user_id = ? AND deleted_at IS NULL)`,
          ulid(), context.workspaceId, userId,
          invite.scopeType === 'workspace' ? roleId : workspaceDefault, rootId,
          ...valid.values, context.workspaceId, userId],
      );
    }
    if (invite.scopeType === 'organization') {
      statements.push([
        `INSERT INTO organization_members (id, organization_id, user_id, organization_member_role_id)
         SELECT ?, ?, ?, ? WHERE ${valid.text}
           AND NOT EXISTS (SELECT 1 FROM organization_members
             WHERE organization_id = ? AND user_id = ? AND deleted_at IS NULL)`,
        ulid(), invite.scopeId, userId, roleId, ...valid.values, invite.scopeId, userId,
      ]);
    } else if (invite.scopeType === 'page') {
      statements.push([
        `INSERT INTO page_collaborators (id, page_id, user_id, page_member_role_id)
         SELECT ?, ?, ?, ? WHERE ${valid.text}
           AND NOT EXISTS (SELECT 1 FROM page_collaborators
             WHERE page_id = ? AND user_id = ? AND deleted_at IS NULL)`,
        ulid(), invite.scopeId, userId, roleId, ...valid.values, invite.scopeId, userId,
      ]);
    }
    const membershipExists = invite.scopeType === 'organization'
      ? `EXISTS (SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ? AND deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM organizations WHERE id = ? AND owner_id = ?)`
      : invite.scopeType === 'workspace'
        ? `EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND deleted_at IS NULL)
           OR EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND created_by_user_id = ?)`
        : `EXISTS (SELECT 1 FROM page_collaborators WHERE page_id = ? AND user_id = ? AND deleted_at IS NULL)
           OR EXISTS (SELECT 1 FROM pages WHERE id = ? AND owner_id = ?)`;
    statements.push(
      [`INSERT INTO access_invite_acceptances (id, invite_id, user_id)
        SELECT ?, ?, ? WHERE ${valid.text} AND (${membershipExists})`,
        acceptanceId, inviteId, userId, ...valid.values,
        invite.scopeId, userId, invite.scopeId, userId],
      [`UPDATE access_invites SET acceptance_count = acceptance_count + 1,
        status = CASE WHEN acceptance_limit IS NOT NULL AND acceptance_count + 1 >= acceptance_limit
          THEN 'accepted' ELSE status END, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND EXISTS (SELECT 1 FROM access_invite_acceptances WHERE id = ?)`,
        inviteId, acceptanceId],
    );
    await rqlite(statements, 'execute', { transaction: true });
    const [accepted] = await rqlite<{ accepted: number }>([[
      `SELECT 1 AS accepted FROM access_invite_acceptances WHERE invite_id = ? AND user_id = ? LIMIT 1`,
      inviteId, userId,
    ]], 'query');
    return accepted?.[0]?.accepted === 1;
  }

  private async scopeContext(scope: AccessScope, scopeId: string): Promise<ScopeContext> {
    if (scope === 'organization') return { organizationId: null, workspaceId: null };
    if (scope === 'workspace') {
      const [rows] = await rqlite<{ organizationId: string | null }>([[
        `SELECT organization_id AS organizationId FROM workspaces WHERE id = ? LIMIT 1`, scopeId,
      ]], 'query');
      return { workspaceId: scopeId, organizationId: rows?.[0]?.organizationId ?? null };
    }
    const [rows] = await rqlite<{ workspaceId: string; organizationId: string | null }>([[
      `WITH RECURSIVE branch(id) AS (
        SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL
        UNION SELECT edge.parent_id FROM page_edges edge JOIN branch ON edge.child_id = branch.id
      )
      SELECT workspace.id AS workspaceId, workspace.organization_id AS organizationId
      FROM branch JOIN workspace_members member ON member.page_root_id = branch.id AND member.deleted_at IS NULL
      JOIN workspaces workspace ON workspace.id = member.workspace_id LIMIT 1`, scopeId,
    ]], 'query');
    return rows?.[0]
      ? { workspaceId: rows[0].workspaceId, organizationId: rows[0].organizationId }
      : { workspaceId: null, organizationId: null };
  }
}

export default new AccessInviteStore();
