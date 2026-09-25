import type { Permissions } from "@/services/auth/types/access.types";

export interface RoleRecord {
  id: string;
  name: string;
  roles: Permissions;
  isDefault: boolean;
  systemKey: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberRecord {
  id: string;
  membershipId: string;
  name: string | null;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissions: Permissions;
}
