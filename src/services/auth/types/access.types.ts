import type { ACCESS_SCOPES } from "@/services/auth/permissions";

export type AccessScope = typeof ACCESS_SCOPES[number];
export type PermissionKind = "read" | "write";

export interface Permissions {
  read: string[];
  write: string[];
}

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
