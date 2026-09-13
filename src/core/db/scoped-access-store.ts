import { rqlite } from "@db/shared";
import { PERMISSION_CATALOG, type AccessScope, type PermissionKind, type ScopeAccess } from "@core/auth/permissions";

export const SCOPE_TABLES = {
  organization: { resource: "organizations", members: "organization_members", owner: "owner_id" },
  workspace: { resource: "workspaces", members: "workspace_members", owner: "created_by_user_id" },
  page: { resource: "pages", members: "page_collaborators", owner: "owner_id" },
} as const;
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function contains(role: string, kind: string, action: string): string {
  return `EXISTS (SELECT 1 FROM json_each(COALESCE(${role}.roles, '{"read":[],"write":[]}'), ${kind}) WHERE value = ${action})`;
}
function grant(role: string, kind = "ctx.kind", action = "ctx.action"): string {
  return `(${contains(role, "'$.read'", "'view'")} AND ${contains(role, `'$.' || ${kind}`, action)})`;
}

/** Também é usado dentro da escrita, para a autorização valer no instante do commit. */
export function accessGuard(scope: AccessScope, scopeId: string, userId: string, kind: PermissionKind | "owner", action: string): SqlStatement {
  const context = `ctx(scope_id, user_id, kind, action) AS (VALUES (?, ?, ?, ?))`;
  const workspaceOwner = `(w.created_by_user_id = ctx.user_id OR o.owner_id = ctx.user_id)`;
  const organizationManager = grant("org_role", "'write'", "'manage_workspaces'");
  const organizationJoins = `LEFT JOIN organizations o ON o.id = w.organization_id
    LEFT JOIN organization_members org_member ON org_member.organization_id = o.id AND org_member.user_id = ctx.user_id AND org_member.deleted_at IS NULL
    LEFT JOIN organization_roles org_role ON org_role.id = org_member.organization_member_role_id AND org_role.organization_id = o.id AND org_role.deleted_at IS NULL`;
  let select: string;
  if (scope === "organization") {
    select = `WITH ${context} SELECT 1 FROM ctx
      JOIN users actor ON actor.id = ctx.user_id
      JOIN organizations o ON o.id = ctx.scope_id
      LEFT JOIN organization_members m ON m.organization_id = o.id AND m.user_id = ctx.user_id AND m.deleted_at IS NULL
      LEFT JOIN organization_roles role ON role.id = m.organization_member_role_id AND role.organization_id = o.id AND role.deleted_at IS NULL
      WHERE o.owner_id = ctx.user_id OR (ctx.kind <> 'owner' AND ${grant("role")})`;
  } else if (scope === "workspace") {
    select = `WITH ${context} SELECT 1 FROM ctx
      JOIN users actor ON actor.id = ctx.user_id
      JOIN workspaces w ON w.id = ctx.scope_id
      ${organizationJoins}
      LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ctx.user_id AND m.deleted_at IS NULL
      LEFT JOIN workspace_roles role ON role.id = m.workspace_member_role_id AND role.workspace_id = w.id AND role.deleted_at IS NULL
      WHERE ${workspaceOwner} OR (ctx.kind <> 'owner' AND (${organizationManager} OR ${grant("role")}))`;
  } else {
    select = `WITH RECURSIVE ${context}, branch(id) AS (
      SELECT p.id FROM pages p JOIN ctx ON p.id = ctx.scope_id WHERE p.deleted_at IS NULL
      UNION SELECT edge.parent_id FROM page_edges edge JOIN branch ON edge.child_id = branch.id
        JOIN pages parent ON parent.id = edge.parent_id AND parent.deleted_at IS NULL
    ), shared_branch(id) AS (
      SELECT p.id FROM pages p JOIN ctx ON p.id = ctx.scope_id WHERE p.deleted_at IS NULL
      UNION SELECT edge.parent_id FROM page_edges edge JOIN shared_branch child ON edge.child_id = child.id
        JOIN pages parent ON parent.id = edge.parent_id AND parent.deleted_at IS NULL
        WHERE NOT EXISTS (SELECT 1 FROM page_collaborators stop JOIN ctx ON stop.user_id = ctx.user_id WHERE stop.page_id = child.id AND stop.deleted_at IS NULL)
    )
    SELECT 1 FROM ctx JOIN users actor ON actor.id = ctx.user_id
    JOIN pages p ON p.id = ctx.scope_id AND p.deleted_at IS NULL
    WHERE EXISTS (SELECT 1 FROM pages ancestor JOIN branch ON branch.id = ancestor.id WHERE ancestor.owner_id = ctx.user_id)
      OR EXISTS (
        SELECT 1 FROM workspace_members root JOIN branch ON branch.id = root.page_root_id
        JOIN workspaces w ON w.id = root.workspace_id ${organizationJoins}
        LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ctx.user_id AND wm.deleted_at IS NULL
        LEFT JOIN workspace_roles workspace_role ON workspace_role.id = wm.workspace_member_role_id AND workspace_role.workspace_id = w.id AND workspace_role.deleted_at IS NULL
        WHERE ${workspaceOwner} OR (ctx.kind <> 'owner' AND (${organizationManager} OR ${grant("workspace_role", "'write'", "'manage_pages'")}))
      )
      OR (ctx.kind <> 'owner' AND EXISTS (
        SELECT 1 FROM page_collaborators m JOIN shared_branch ON shared_branch.id = m.page_id
        JOIN page_roles role ON role.id = m.page_member_role_id AND role.page_id = m.page_id AND role.deleted_at IS NULL
        WHERE m.user_id = ctx.user_id AND m.deleted_at IS NULL AND ${grant("role")}
          AND (m.page_id = ctx.scope_id OR (
            ${contains("role", "'$.read'", "'subpages'")}
            AND NOT EXISTS (SELECT 1 FROM page_collaborators direct WHERE direct.page_id = ctx.scope_id AND direct.user_id = ctx.user_id AND direct.deleted_at IS NULL)
            AND (ctx.kind = 'read' OR (ctx.action IN ('update','create','edit_subpages') AND ${contains("role", "'$.write'", "'edit_subpages'")}))
          ))
      ))`;
  }
  return { text: `EXISTS (${select})`, values: [scopeId, userId, kind, action] };
}

export class ScopedAccessStore {
  async can(scope: AccessScope, scopeId: string, userId: string, kind: PermissionKind, action: string): Promise<boolean> {
    if (!ULID_RE.test(scopeId) || !ULID_RE.test(userId)) return false;
    if (!(PERMISSION_CATALOG[scope][kind] as readonly string[]).includes(action)) return false;
    const guard = accessGuard(scope, scopeId, userId, kind, action);
    const [rows] = await rqlite<{ allowed: number }>([[`SELECT ${guard.text} AS allowed`, ...guard.values]], "query");
    return rows?.[0]?.allowed === 1;
  }

  async get(scope: AccessScope, scopeId: string, userId: string): Promise<ScopeAccess | null> {
    if (!ULID_RE.test(scopeId) || !ULID_RE.test(userId)) return null;
    const tables = SCOPE_TABLES[scope];
    const probes = (["read", "write"] as const).flatMap((kind) => PERMISSION_CATALOG[scope][kind].map((action) => ({ kind, action })));
    const ownerGuard = accessGuard(scope, scopeId, userId, "owner", "owner");
    const results = await rqlite<Record<string, unknown>>([
      [`SELECT resource.${tables.owner} AS owner_id, m.id AS membership_id,
        role.id AS role_id, role.name AS role_name
        FROM ${tables.resource} resource
        LEFT JOIN ${tables.members} m ON m.${scope}_id = resource.id AND m.user_id = ? AND m.deleted_at IS NULL
        LEFT JOIN ${scope}_roles role ON role.id = m.${scope}_member_role_id AND role.${scope}_id = resource.id AND role.deleted_at IS NULL
        WHERE resource.id = ? ${scope === 'page' ? 'AND resource.deleted_at IS NULL' : ''}`, userId, scopeId],
      [`SELECT ${ownerGuard.text} AS allowed`, ...ownerGuard.values],
      ...probes.map(({ kind, action }) => {
        const guard = accessGuard(scope, scopeId, userId, kind, action);
        return [`SELECT ${guard.text} AS allowed`, ...guard.values] as RqliteStatement;
      }),
    ], "query");
    const metadata = results[0]?.[0];
    if (!metadata) return null;
    const access: ScopeAccess = {
      scope, scopeId,
      ownerId: metadata.owner_id as string | null,
      isOwner: results[1]?.[0]?.allowed === 1,
      isMember: Boolean(metadata.membership_id),
      roleId: metadata.role_id as string | null,
      roleName: metadata.role_name as string | null,
      permissions: { read: [], write: [] },
    };
    probes.forEach(({ kind, action }, index) => {
      if (results[index + 2]?.[0]?.allowed === 1) access.permissions[kind].push(action);
    });
    return access;
  }
}

export default new ScopedAccessStore();
