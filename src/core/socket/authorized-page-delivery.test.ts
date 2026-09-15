import {beforeEach,describe,it,expect,vi} from 'vitest';
const access=vi.hoisted(()=>({can:vi.fn()}));
vi.mock('@db/scoped-access-store',()=>({default:access}));
import {authorizedPageDelivery} from './authorized-page-delivery.js';
import type {CubsSocketServer} from './socket-types.js';
describe('entrega de eventos após mudança de permissões',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('retira o socket revogado e mantém a ordem de entrega para quem pode ler',async()=>{
  const allowed={data:{userId:'reader'},rooms:new Set(['page-database:p']),emit:vi.fn(),leave:vi.fn()};
  const revoked={data:{userId:'revoked'},rooms:new Set(['page-database:p']),emit:vi.fn(),leave:vi.fn()};
  access.can.mockImplementation(async(_scope,_id,user)=>user==='reader');
  const io={sockets:{sockets:new Map([['a',allowed],['b',revoked]]),adapter:{rooms:new Map([['page-database:p',new Set(['a','b'])]])}}} as unknown as CubsSocketServer;
  const payload={pageId:'p',viewId:'v',data:{},eventId:'e',updatedAt:'2026-01-01T00:00:00.000Z',originUserId:'owner',version:1 as const};
  authorizedPageDelivery(io,'view-updated',payload);
  await vi.waitFor(()=>expect(allowed.emit).toHaveBeenCalledWith('view-updated',payload));
  expect(revoked.emit).not.toHaveBeenCalledWith('view-updated',expect.anything());
  await vi.waitFor(()=>expect(revoked.leave).toHaveBeenCalledWith('page-database:p'));
 });
 it('não entrega a linha com role própria que nega leitura',async()=>{
  const socket={data:{userId:'reader'},rooms:new Set(['page-database:p2']),emit:vi.fn(),leave:vi.fn()};
  access.can.mockImplementation(async(_scope,id)=>id==='p2');
  const io={sockets:{sockets:new Map([['a',socket]]),adapter:{rooms:new Map([['page-database:p2',new Set(['a'])]])}}} as unknown as CubsSocketServer;
  authorizedPageDelivery(io,'cell-updated',{pageId:'p2',rowId:'hidden',columnId:'col',value:'secret',updatedAt:'2026-01-01T00:00:00.000Z',originUserId:'owner'});
  await vi.waitFor(()=>expect(access.can).toHaveBeenCalledWith('page','hidden','reader','read','view'));
  expect(socket.emit).not.toHaveBeenCalled();
 });
 it('entrega row-created pela autorização da parent sem consultar a filha recém-criada',async()=>{
  const socket={data:{userId:'reader'},rooms:new Set(['page-database:p3']),emit:vi.fn(),leave:vi.fn()};
  access.can.mockImplementation(async(_scope,id)=>id==='p3');
  const io={sockets:{sockets:new Map([['a',socket]]),adapter:{rooms:new Map([['page-database:p3',new Set(['a'])]])}}} as unknown as CubsSocketServer;
  const payload={pageId:'p3',rowId:'new-child',updatedAt:'2026-01-01T00:00:00.000Z',originUserId:'owner'};

  authorizedPageDelivery(io,'row-created',payload);

  await vi.waitFor(()=>expect(socket.emit).toHaveBeenCalledWith('row-created',payload));
  expect(access.can).toHaveBeenCalledTimes(1);
  expect(access.can).toHaveBeenCalledWith('page','p3','reader','read','subpages');
  expect(access.can).not.toHaveBeenCalledWith('page','new-child','reader','read','view');
 });
 it('continua negando row-created quando a leitura de subitens da parent foi revogada',async()=>{
  const socket={data:{userId:'revoked'},rooms:new Set(['page-database:p4']),emit:vi.fn(),leave:vi.fn()};
  access.can.mockResolvedValue(false);
  const io={sockets:{sockets:new Map([['a',socket]]),adapter:{rooms:new Map([['page-database:p4',new Set(['a'])]])}}} as unknown as CubsSocketServer;
  const payload={pageId:'p4',rowId:'new-child',updatedAt:'2026-01-01T00:00:00.000Z',originUserId:'owner'};

  authorizedPageDelivery(io,'row-created',payload);

  await vi.waitFor(()=>expect(socket.leave).toHaveBeenCalledWith('page-database:p4'));
  expect(socket.emit).toHaveBeenCalledWith('page-database-denied',{pageId:'p4'});
  expect(socket.emit).not.toHaveBeenCalledWith('row-created',payload);
 });
});
