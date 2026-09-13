import { ulid } from 'ulid';
import { rqlite } from '@db/shared';
import { accessGuard, SCOPE_TABLES } from './scoped-access-store.js';
import roles, { delegationGuard } from './role-store.js';
import type { AccessScope } from '@core/auth/permissions';

export interface MembershipRequest {
  id: string; scopeId: string; requesterId: string; requesterName: string | null; requesterEmail: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired'; acceptedBy: string | null; decidedBy: string | null;
  decidedAt: string | null; createdAt: string; notifiedEmails: string[]; roleId: string | null;
}
class MembershipRequestStore {
  async list(scope: AccessScope, scopeId: string, actorId: string): Promise<MembershipRequest[]> {
    const manager = accessGuard(scope, scopeId, actorId, 'write', 'add_members');
    const [rows] = await rqlite<MembershipRequest & { notifiedEmails: string }>([[
      `SELECT r.id, r.${scope}_id AS scopeId, r.requester_id AS requesterId, u.name AS requesterName,
        u.email AS requesterEmail, r.status, r.accepted_by AS acceptedBy, r.decided_by AS decidedBy,
        r.decided_at AS decidedAt, r.created_at AS createdAt, r.role_id AS roleId,
        CASE WHEN ${manager.text} THEN r.notified_emails ELSE '[]' END AS notifiedEmails
        FROM ${scope}_pending_requests r JOIN users u ON u.id = r.requester_id
        WHERE r.${scope}_id = ? AND r.deleted_at IS NULL AND (r.requester_id = ? OR ${manager.text})
        ORDER BY r.created_at DESC, r.id DESC`,
      ...manager.values, scopeId, actorId, ...manager.values,
    ]], 'query');
    return (rows ?? []).map(row => ({ ...row, notifiedEmails: JSON.parse(row.notifiedEmails) as string[] }));
  }
  async create(scope: AccessScope, scopeId: string, userId: string) {
    const id = ulid();
    const [created] = await rqlite([[
      `INSERT INTO ${scope}_pending_requests (id, ${scope}_id, requester_id)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${SCOPE_TABLES[scope].resource} WHERE id = ? ${scope === 'page' ? 'AND deleted_at IS NULL' : ''})
        AND EXISTS (SELECT 1 FROM users WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM ${SCOPE_TABLES[scope].members} WHERE ${scope}_id = ? AND user_id = ? AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM ${scope}_pending_requests WHERE ${scope}_id = ? AND requester_id = ? AND status = 'pending' AND deleted_at IS NULL)`,
      id, scopeId, userId, scopeId, userId, scopeId, userId, scopeId, userId,
    ]], 'execute', { transaction: true });
    const request = (await this.list(scope, scopeId, userId)).find(row => row.status === 'pending');
    return request ? { request, created: created === true } : null;
  }
  async decide(scope: AccessScope, scopeId: string, requestId: string, actorId: string, decision: 'accepted' | 'rejected', roleId?: string) {
    const manager = accessGuard(scope, scopeId, actorId, 'write', 'add_members');
    if (decision === 'rejected') {
      const [saved] = await rqlite([[`UPDATE ${scope}_pending_requests SET status = 'rejected', decided_by = ?,
        decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND ${scope}_id = ? AND status = 'pending' AND deleted_at IS NULL AND ${manager.text}`,
        actorId, requestId, scopeId, ...manager.values]], 'execute', { transaction: true });
      return saved === true;
    }
    if (!roleId) return false;
    const request = (await this.list(scope, scopeId, actorId)).find(row => row.id === requestId && row.status === 'pending');
    if (!request) return false;
    const membershipId = ulid();
    const delegate = delegationGuard(scope, scopeId, actorId, 'candidate.roles');
    const condition: SqlStatement = {
      text: `${manager.text}
        AND EXISTS (SELECT 1 FROM ${scope}_pending_requests WHERE id = ? AND ${scope}_id = ? AND requester_id = ? AND status = 'pending' AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM ${SCOPE_TABLES[scope].members} WHERE ${scope}_id = ? AND user_id = ? AND deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM ${scope}_roles candidate WHERE candidate.id = ? AND candidate.${scope}_id = ? AND candidate.deleted_at IS NULL AND ${delegate.text})`,
      values: [...manager.values, requestId, scopeId, request.requesterId, scopeId, request.requesterId, roleId, scopeId, ...delegate.values],
    };
    const statements = roles.memberStatements(scope, scopeId, request.requesterId, roleId, membershipId, condition);
    statements.push([`UPDATE ${scope}_pending_requests SET status = 'accepted', accepted_by = ?, decided_by = ?,
      decided_at = CURRENT_TIMESTAMP, role_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ${scope}_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM ${SCOPE_TABLES[scope].members} WHERE id = ?)`,
      actorId, actorId, roleId, requestId, scopeId, membershipId]);
    const results = await rqlite(statements, 'execute', { transaction: true });
    return results.length === statements.length && results.every(Boolean);
  }
  async recordNotification(scope: AccessScope, id: string, email: string) {
    await rqlite([[`UPDATE ${scope}_pending_requests
      SET notified_emails = json_insert(notified_emails, '$[#]', ?), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM json_each(notified_emails) WHERE value = ?)`, email, id, email]], 'execute');
  }
  async notificationContext(scope: AccessScope, scopeId: string, requesterId: string) {
    // Só considera pessoas relacionadas ao escopo; o filtro de permissões vem em seguida.
    const organizationPeople = `SELECT owner_id AS id FROM organizations WHERE id = ?
      UNION SELECT user_id FROM organization_members WHERE organization_id = ? AND deleted_at IS NULL`;
    const workspacePeople = `SELECT created_by_user_id AS id FROM workspaces WHERE id IN (SELECT id FROM selected_workspaces)
      UNION SELECT user_id FROM workspace_members WHERE workspace_id IN (SELECT id FROM selected_workspaces) AND deleted_at IS NULL
      UNION SELECT owner_id FROM organizations WHERE id IN (SELECT organization_id FROM selected_workspaces)
      UNION SELECT user_id FROM organization_members WHERE organization_id IN (SELECT organization_id FROM selected_workspaces) AND deleted_at IS NULL`;
    const candidates: RqliteStatement = scope === 'organization'
      ? [`SELECT id, name, email FROM users WHERE id IN (${organizationPeople})`, scopeId, scopeId]
      : scope === 'workspace'
        ? [`WITH selected_workspaces AS (SELECT id, organization_id FROM workspaces WHERE id = ?)
          SELECT id, name, email FROM users WHERE id IN (${workspacePeople})`, scopeId]
        : [`WITH RECURSIVE branch(id) AS (
            SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL
            UNION SELECT e.parent_id FROM page_edges e JOIN branch ON branch.id = e.child_id
              JOIN pages p ON p.id = e.parent_id AND p.deleted_at IS NULL
          ), selected_workspaces AS (
            SELECT DISTINCT w.id, w.organization_id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id AND m.deleted_at IS NULL
              JOIN branch ON branch.id = m.page_root_id
          ) SELECT id, name, email FROM users WHERE id IN (
            SELECT owner_id FROM pages WHERE id IN (SELECT id FROM branch)
            UNION SELECT user_id FROM page_collaborators WHERE page_id IN (SELECT id FROM branch) AND deleted_at IS NULL
            UNION ${workspacePeople})`, scopeId];
    const [resources, people, requesters] = await rqlite<{ name: string; email: string; id: string }>([
      [`SELECT ${scope === 'page' ? 'title' : 'name'} AS name FROM ${SCOPE_TABLES[scope].resource} WHERE id = ?`, scopeId],
      candidates,
      ['SELECT id, name, email FROM users WHERE id = ?', requesterId],
    ], 'query');
    const recipients = (people ?? []).filter(person => person.id !== requesterId);
    const checks = recipients.length ? await rqlite<{ allowed: number }>(recipients.map(person => {
      const guard = accessGuard(scope, scopeId, person.id, 'write', 'add_members');
      return [`SELECT ${guard.text} AS allowed`, ...guard.values] as RqliteStatement;
    }), 'query') : [];
    const approvers = recipients.filter((_person, index) => checks[index]?.[0]?.allowed === 1);
    return { scopeName: resources?.[0]?.name ?? '', requester: requesters?.[0], approvers };
  }
}
export default new MembershipRequestStore();
