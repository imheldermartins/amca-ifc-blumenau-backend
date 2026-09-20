import type { ScopeAccess } from "@/services/auth/types/access.types";

export interface OrganizationSummary extends ScopeAccess {
  id: string;
  name: string;
  data: Record<string, unknown>;
  role: string | null;
  workspaceCount: number;
}

export interface OrganizationWorkspaceUser {
  id: string;
  name: string | null;
  email: string;
  organizationRole: string | null;
  workspaceRole: string | null;
}

export interface CreateOrganizationProvision {
  organizationId: string;
  organizationName: string;
  membershipId: string;
  ownerId: string;
}
