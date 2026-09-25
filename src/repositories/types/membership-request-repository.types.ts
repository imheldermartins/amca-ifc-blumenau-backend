export interface MembershipRequest {
  id: string;
  scopeId: string;
  requesterId: string;
  requesterName: string | null;
  requesterEmail: string;
  status: "pending" | "accepted" | "rejected" | "canceled" | "expired";
  acceptedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  notifiedEmails: string[];
  roleId: string | null;
}
