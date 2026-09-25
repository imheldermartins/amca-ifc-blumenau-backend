import type { AccessScope } from '@/services/auth/permissions';

export interface MembershipRequestNotificationInput {
  scope: AccessScope;
  scopeId: string;
  requesterId: string;
  requestId: string;
}

export interface MembershipRequestNotificationResult {
  notificationPending: boolean;
}

export interface MembershipRequestNotifier {
  notify(input: MembershipRequestNotificationInput): Promise<MembershipRequestNotificationResult>;
}
