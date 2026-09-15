import access from '@db/scoped-access-store';
import type { CubsSocketServer } from './socket-types.js';
import type { PageEditEventName } from './page-edit-channel.js';
import type { ServerToClientEvents } from './realtime-contract-v1.js';
import { roomForPage } from './page-room.js';

export type PageEventDelivery = (io: CubsSocketServer, event: PageEditEventName, payload: Parameters<ServerToClientEvents[PageEditEventName]>[0]) => void;
const queues = new Map<string, Promise<void>>();
/** Revalida cada destinatário antes de entregar dados, inclusive após revogação. */
export const authorizedPageDelivery: PageEventDelivery = (io,event,payload) => {
  const previous = queues.get(payload.pageId) ?? Promise.resolve();
  const task = previous.then(async () => {
    const room = roomForPage(payload.pageId);
    for (const socketId of [...(io.sockets.adapter.rooms.get(room) ?? [])]) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket?.rooms.has(room)) continue;
      if (!await access.can('page',payload.pageId,socket.data.userId,'read','subpages')) {
        await socket.leave(room);
        socket.emit('page-database-denied',{pageId:payload.pageId});
        continue;
      }
      // A criação grava página, aresta e role default no mesmo commit, sem
      // criar page_collaborators na filha. Nesse instante a visibilidade dos
      // destinatários é herdada da parent. Evitar a segunda leitura também
      // impede que uma réplica ainda sem a nova página descarte o primeiro
      // `row-created`. Nos eventos posteriores, a política própria da filha
      // continua sendo revalidada normalmente.
      const needsRowAuthorization = 'rowId' in payload
        && event !== 'row-created'
        && event !== 'row-deleted';
      if (needsRowAuthorization && !await access.can('page',payload.rowId,socket.data.userId,'read','view')) continue;
      const target = socket as unknown as {emit(event:PageEditEventName,payload:unknown):void};
      target.emit(event,payload);
    }
  }).catch(() => { console.error('[cubs:realtime] Não foi possível confirmar as permissões da entrega.'); });
  queues.set(payload.pageId,task);
  void task.finally(()=>{if(queues.get(payload.pageId)===task)queues.delete(payload.pageId)});
};
