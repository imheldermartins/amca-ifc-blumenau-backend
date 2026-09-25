import type { ScopeAccess } from "@/services/auth/types/access.types";

export interface WorkspaceSummary extends ScopeAccess {
  id: string;
  name: string | null;
  data: Record<string, unknown>;
  organizationId: string | null;
  organizationName: string | null;
  isPersonal: boolean;
  icon: string;
  createdByUserId: string | null;
  pageRootId: string;
  role: string | null;
  owner: { id: string | null; name: string | null; email: string | null };
}

export interface WorkspaceMemberSummary {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  pageRootId: string;
  roleId: string | null;
  roleName: string | null;
}

export interface CreateWorkspaceProvision {
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string;
  organizationId: string;
  ownerId: string;
  rootTitle: string;
  membershipId: string;
}
