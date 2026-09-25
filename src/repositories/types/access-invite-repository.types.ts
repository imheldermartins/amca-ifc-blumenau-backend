import type { AccessScope } from "@/services/auth/types/access.types";

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
  status: "pending" | "accepted" | "rejected" | "canceled" | "expired";
  expiresAt: string | null;
  acceptanceLimit: number | null;
  acceptanceCount: number;
  notifiedAt: string | null;
  createdAt: string;
}

export interface InviteScopeContext {
  workspaceId: string | null;
  organizationId: string | null;
}
