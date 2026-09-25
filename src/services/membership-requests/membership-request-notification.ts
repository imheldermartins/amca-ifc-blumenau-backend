import requestStore from '@/db/repositories/membership-request-store';
import access from '@/db/repositories/scoped-access-store';
import type { AccessScope } from '@/services/auth/permissions';
import { membershipRequestEmail } from '@/services/mail/membership-request-email';
import { SmtpService } from '@/services/mail/smtp-service';
import type {
  MembershipRequestNotificationInput,
  MembershipRequestNotificationResult,
  MembershipRequestNotifier,
} from '@/services/membership-requests/types/membership-request-notification.types';

const SCOPE_LABELS = {
  organization: 'Organização',
  workspace: 'Workspace',
  page: 'Página',
} as const satisfies Record<AccessScope, 'Organização' | 'Workspace' | 'Página'>;

/** Envia a solicitação persistida somente a quem ainda pode aprovar o acesso. */
export class MembershipRequestNotificationService implements MembershipRequestNotifier {
  async notify(input: MembershipRequestNotificationInput): Promise<MembershipRequestNotificationResult> {
    let smtp: SmtpService | undefined;
    let notificationPending = false;

    try {
      const origin = process.env.APP_PUBLIC_URL;
      if (!origin) throw new Error('APP_PUBLIC_URL não configurada');

      smtp = SmtpService.fromEnvironment();
      const context = await requestStore.notificationContext(input.scope, input.scopeId, input.requesterId);
      if (!context.requester || !context.approvers.length) {
        throw new Error('Destinatários indisponíveis');
      }

      for (const approver of context.approvers) {
        try {
          // Uma revogação ocorrida depois da consulta também remove o destinatário.
          const canApprove = await access.can(
            input.scope,
            input.scopeId,
            approver.id,
            'write',
            'add_members',
          );
          if (!canApprove) continue;

          await smtp.send(membershipRequestEmail.create({
            recipient: {
              name: approver.name || approver.email,
              email: approver.email,
            },
            requester: {
              name: context.requester.name || context.requester.email,
              email: context.requester.email,
            },
            scopeName: context.scopeName,
            scopeType: SCOPE_LABELS[input.scope],
            reviewUrl: new URL(
              `/pt-br/access/${input.scope}/${input.scopeId}/requests/${input.requestId}`,
              origin,
            ).toString(),
          }));
          await requestStore.recordNotification(input.scope, input.requestId, approver.email);
        } catch {
          notificationPending = true;
        }
      }
    } catch {
      notificationPending = true;
    } finally {
      smtp?.close();
    }

    return { notificationPending };
  }
}

export default new MembershipRequestNotificationService();
