import type { MembershipRequest } from '@/db/repositories/membership-request-store';
import type { AccessScope } from '@/services/auth/permissions';

export interface StoredMembershipRequest {
  request: MembershipRequest;
  created: boolean;
}

export interface MembershipRequestCreationStore {
  create(
    scope: AccessScope,
    scopeId: string,
    requesterId: string,
  ): Promise<StoredMembershipRequest | null>;
}

export interface MembershipRequestCreateResult {
  request: MembershipRequest;
  notificationPending: boolean;
}
