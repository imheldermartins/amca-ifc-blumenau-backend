import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
const mocks = vi.hoisted(() => ({
  access: { get: vi.fn(), can: vi.fn() },
  roles: { save: vi.fn(), addMember: vi.fn(), members: vi.fn(), removeMember: vi.fn() },
  requests: { create: vi.fn(), list: vi.fn(), decide: vi.fn(), notificationContext: vi.fn(), recordNotification: vi.fn() },
  send: vi.fn(), close: vi.fn(),
}));
vi.mock('@/repositories/scoped-access-repository', () => ({ default: mocks.access, ULID_RE: /^[0-9A-HJKMNP-TV-Z]{26}$/i }));
vi.mock('@/repositories/role-repository', () => ({ default: mocks.roles }));
vi.mock('@/repositories/membership-request-repository', () => ({ default: mocks.requests }));
vi.mock('@/services/mail/send-email', () => ({ SendEmail: { fromEnvironment: () => ({ send: mocks.send, close: mocks.close }) } }));
import controller from './access-controller.js';
const scopeId = ulid(), actor = ulid(), requester = ulid(), requestId = ulid(), roleId = ulid();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:5173');
  mocks.access.get.mockResolvedValue({ permissions: { read: ['view'], write: ['create_page_roles'] } });
  mocks.access.can.mockResolvedValue(true);
  mocks.requests.create.mockResolvedValue({ created: true, request: { id: requestId } });
  mocks.requests.notificationContext.mockResolvedValue({
    scopeName: 'Equipe', requester: { name: 'Solicitante', email: 'requester@example.test' },
    approvers: [{ id: actor, name: 'Responsável', email: 'approver@example.test' }],
  });
});
describe('AccessController', () => {
  it('valida o alvo da remoção e passa o ator autenticado ao repositório', async () => {
    expect(await controller.removeMember('page', scopeId, actor, 'invalid')).toMatchObject({ ok: false, reason: 'validation' });
    expect(mocks.roles.removeMember).not.toHaveBeenCalled();
    mocks.roles.removeMember.mockResolvedValue(false);
    expect(await controller.removeMember('page', scopeId, actor, requester)).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(mocks.roles.removeMember).toHaveBeenCalledWith('page', scopeId, actor, requester);
    mocks.roles.removeMember.mockResolvedValue(true);
    expect(await controller.removeMember('page', scopeId, actor, requester)).toMatchObject({ ok: true, data: { saved: true } });
  });
  it('rejeita permissões desconhecidas e delegação acima do ator', async () => {
    expect(await controller.saveRole('page', scopeId, actor, { name: 'Inválida', roles: { read: ['view'], write: ['superadmin'] } })).toMatchObject({ ok: false, reason: 'validation' });
    expect(await controller.saveRole('page', scopeId, actor, { name: 'Escalada', roles: { read: ['view'], write: ['delete'] } })).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(mocks.roles.save).not.toHaveBeenCalled();
  });
  it('usa o ator autenticado no aceite e ignora accepted_by do payload', async () => {
    mocks.requests.decide.mockResolvedValue(true);
    expect(await controller.decide('page',scopeId,actor,requestId,{decision:'accepted',roleId,accepted_by:requester})).toMatchObject({ok:true});
    expect(mocks.requests.decide).toHaveBeenCalledWith('page',scopeId,requestId,actor,'accepted',roleId);
  });
  it('abrir solicitações é uma leitura, sem consumir ou aceitar', async () => {
    mocks.requests.list.mockResolvedValue([]);
    await controller.requests('page',scopeId,actor);
    expect(mocks.requests.decide).not.toHaveBeenCalled();
    expect(mocks.requests.create).not.toHaveBeenCalled();
  });
  it('registra o destinatário somente após SMTP aceitar a mensagem', async () => {
    const result = await controller.request('page',scopeId,requester);
    expect(result).toMatchObject({ok:true,data:{notificationPending:false}});
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to:{name:'Responsável',email:'approver@example.test'},
      content:{html:expect.stringContaining('/requests/'+requestId),text:expect.any(String)},
    }));
    expect(mocks.requests.recordNotification).toHaveBeenCalledWith('page',requestId,'approver@example.test');
    expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(mocks.requests.recordNotification.mock.invocationCallOrder[0]!);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('mantém o pedido e sinaliza envio pendente se o SMTP falhar', async () => {
    mocks.send.mockRejectedValue(new Error('SMTP indisponível'));
    expect(await controller.request('page',scopeId,requester)).toMatchObject({ok:true,data:{notificationPending:true}});
    expect(mocks.requests.recordNotification).not.toHaveBeenCalled();
  });
});
