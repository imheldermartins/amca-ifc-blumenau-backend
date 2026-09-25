import { describe, expect, it, vi } from 'vitest';
import type { MembershipRequest } from '@/db/repositories/membership-request-store';
import { MembershipRequestService } from './membership-request-service.js';

const request: MembershipRequest = {
  id: '01K5H7CSM4N8VQ3W2Y1Z0ABCDE',
  scopeId: '01K5H7CSM4N8VQ3W2Y1Z0ABCDF',
  requesterId: '01K5H7CSM4N8VQ3W2Y1Z0ABCDG',
  requesterName: 'Solicitante',
  requesterEmail: 'requester@example.test',
  status: 'pending',
  acceptedBy: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-20T14:30:00.000Z',
  notifiedEmails: [],
  roleId: null,
};

describe('MembershipRequestService', () => {
  it('persiste uma nova solicitação e notifica os aprovadores', async () => {
    const store = { create: vi.fn().mockResolvedValue({ request, created: true }) };
    const notifier = { notify: vi.fn().mockResolvedValue({ notificationPending: true }) };
    const service = new MembershipRequestService(store, notifier);

    await expect(service.create('page', request.scopeId, request.requesterId)).resolves.toEqual({
      request,
      notificationPending: true,
    });
    expect(store.create).toHaveBeenCalledWith('page', request.scopeId, request.requesterId);
    expect(notifier.notify).toHaveBeenCalledWith({
      scope: 'page',
      scopeId: request.scopeId,
      requesterId: request.requesterId,
      requestId: request.id,
    });
  });

  it('reaproveita solicitação pendente sem reenviar a notificação', async () => {
    const store = { create: vi.fn().mockResolvedValue({ request, created: false }) };
    const notifier = { notify: vi.fn() };
    const service = new MembershipRequestService(store, notifier);

    await expect(service.create('workspace', request.scopeId, request.requesterId)).resolves.toEqual({
      request,
      notificationPending: false,
    });
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('propaga ausência de solicitação sem tentar notificar', async () => {
    const store = { create: vi.fn().mockResolvedValue(null) };
    const notifier = { notify: vi.fn() };
    const service = new MembershipRequestService(store, notifier);

    await expect(service.create('organization', request.scopeId, request.requesterId)).resolves.toBeNull();
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
