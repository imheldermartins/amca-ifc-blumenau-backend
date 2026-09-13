/** Contrato portátil das permissões. Os nomes das roles são dados editáveis. */
export const ACCESS_SCOPES = ["organization", "workspace", "page"] as const;
export type AccessScope = typeof ACCESS_SCOPES[number];
export type PermissionKind = "read" | "write";
export interface Permissions { read: string[]; write: string[] }

export const PERMISSION_CATALOG = {
  organization: {
    read: ["view", "workspaces", "members", "roles"],
    write: ["update", "create", "add_members", "promote_members", "create_org_roles", "manage_workspaces"],
  },
  workspace: {
    read: ["view", "members", "roles"],
    write: ["update", "create", "add_members", "promote_members", "create_wk_roles", "manage_pages"],
  },
  page: {
    read: ["view", "subpages", "members", "roles"],
    write: ["update", "create", "edit_subpages", "delete", "add_members", "promote_members", "create_page_roles"],
  },
} as const;

export interface ScopeAccess {
  scope: AccessScope;
  scopeId: string;
  ownerId: string | null;
  isOwner: boolean;
  isMember: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: Permissions;
}

export function fullPermissions(scope: AccessScope): Permissions {
  return { read: [...PERMISSION_CATALOG[scope].read], write: [...PERMISSION_CATALOG[scope].write] };
}

export function allows(access: Pick<ScopeAccess, "permissions"> | null, kind: PermissionKind, action: string): boolean {
  return Boolean(access?.permissions.read.includes("view") && access.permissions[kind].includes(action));
}

export function parsePermissions(scope: AccessScope, input: unknown): Permissions | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "read" && key !== "write")) return null;
  const output: Permissions = { read: [], write: [] };
  for (const kind of ["read", "write"] as const) {
    const values = value[kind];
    if (!Array.isArray(values) || values.some((action) => typeof action !== "string"
      || !(PERMISSION_CATALOG[scope][kind] as readonly string[]).includes(action))) return null;
    output[kind] = [...new Set(values)] as string[];
  }
  if ((output.read.length || output.write.length) && !output.read.includes("view")) return null;
  if (output.write.includes("edit_subpages")
    && (!output.write.includes("update") || !output.read.includes("subpages"))) return null;
  return output;
}

export function canDelegate(actor: ScopeAccess, permissions: Permissions): boolean {
  return (["read", "write"] as const).every((kind) => permissions[kind].every((action) => actor.permissions[kind].includes(action)));
}

export const ROLE_MANAGEMENT_PERMISSION = {
  organization: "create_org_roles", workspace: "create_wk_roles", page: "create_page_roles",
} as const;
