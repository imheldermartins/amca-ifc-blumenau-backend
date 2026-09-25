import requestStore from '@/repositories/membership-request-repository';
import type { AccessScope } from '@/services/auth/permissions';
import membershipRequestNotification from '@/services/membership-requests/membership-request-notification';
import type { MembershipRequestNotifier } from '@/services/membership-requests/types/membership-request-notification.types';
import type {
  MembershipRequestCreateResult,
  MembershipRequestCreationStore,
} from '@/services/membership-requests/types/membership-request-service.types';

/** Coordena persistência e notificação sem expor detalhes do banco ao controller. */
export class MembershipRequestService {
  constructor(
    private readonly store: MembershipRequestCreationStore = requestStore,
    private readonly notifier: MembershipRequestNotifier = membershipRequestNotification,
  ) {}

  async create(
    scope: AccessScope,
    scopeId: string,
    requesterId: string,
  ): Promise<MembershipRequestCreateResult | null> {
    const stored = await this.store.create(scope, scopeId, requesterId);
    if (!stored) return null;

    const notification = stored.created
      ? await this.notifier.notify({
        scope,
        scopeId,
        requesterId,
        requestId: stored.request.id,
      })
      : { notificationPending: false };

    return {
      request: stored.request,
      notificationPending: notification.notificationPending,
    };
  }
}

export default new MembershipRequestService();
