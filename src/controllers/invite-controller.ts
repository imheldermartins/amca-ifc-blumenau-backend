import inviteTokenService from '@/services/invitations/invite-token-service';
import type { InviteTokenPreview } from '@/services/invitations/types/invite-token-service.types';

export class InviteController {
  public preview(token: unknown): Promise<InviteTokenPreview> {
    return inviteTokenService.preview(token);
  }

  public accept(token: unknown, userId: string): Promise<boolean> {
    return inviteTokenService.accept(token, userId);
  }
}

export default new InviteController();
