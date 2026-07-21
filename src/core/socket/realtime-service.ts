import pageAccessController from "@/controllers/page-access-controller";
import type { CubsSocket, CubsSocketServer } from "@core/socket/socket-server";

/**
 * Sincronização em tempo real da CubsDatabase.
 *
 * **A SALA É A PÁGINA** (`page-database:{pageId}`), nunca a workspace. É o que
 * faz dono e colaborador se enxergarem: o dono chega pela workspace (que só
 * resolve o id da página de entrada) e o colaborador pela url `/page/:id` — os
 * dois acabam no MESMO id, logo na mesma sala. Sala por workspace separaria
 * justamente quem está olhando a mesma tabela.
 *
 * **Escrita NUNCA passa por aqui.** Quem grava é o HTTP (router → controller →
 * rqlite, sempre no líder do Raft); o socket só propaga o fato DEPOIS do
 * commit. Isso evita escrita duplicada, fora de ordem ou num nó que não é
 * líder — a consistência continua sendo do Raft, o socket é notificação.
 *
 * **Autorização no join é obrigatória**: sem ela, qualquer autenticado que
 * adivinhasse um ULID escutaria as edições de outro tenant. A pergunta é a
 * mesma das rotas HTTP (`canAccessPage`: dono OU colaborador).
 *
 * Convenção de nomes: comando no IMPERATIVO (o que o client pede) e evento no
 * PARTICÍPIO (o que o servidor confirma/propaga) — `join-page-database` →
 * `joined-page-database`; `cell-updated` etc.
 */

/** Payload comum a todo evento de sala — a base do merge no client. */
interface RealtimePayload {
  pageId: string;
  /** Carimbo do commit (ISO). O client descarta evento mais VELHO que o dado. */
  updatedAt: string;
  /** Quem originou. O client ignora o próprio eco (não é do socket: é do USUÁRIO,
   *  então duas abas da mesma conta também não brigam entre si). */
  originUserId: string;
}

export interface CellUpdatedPayload extends RealtimePayload {
  rowId: string;
  columnId: string;
  /** Valor já sem envelope; `null` = célula limpa. */
  value: unknown;
}

export interface ColumnUpdatedPayload extends RealtimePayload {
  columnId: string;
  /** A coluna inteira como ficou (nome, type, data com options). */
  column: unknown;
}

export interface ViewUpdatedPayload extends RealtimePayload {
  /** O `pages.data` inteiro — o snapshot é retrato completo, não patch. */
  data: unknown;
}

export interface RowPayload extends RealtimePayload {
  rowId: string;
}

/**
 * O TÍTULO de uma linha mudou. Evento próprio porque `pages.title` não é uma
 * `page_columns` — é campo da própria página; o frontend o desenha na coluna
 * sintética de título.
 */
export interface RowUpdatedPayload extends RealtimePayload {
  rowId: string;
  title: string | null;
}

export interface PresencePayload {
  pageId: string;
  count: number;
}

/**
 * Contrato de eventos de SALA — espelhado em
 * cubs-frontend/src/services/SocketService.ts. Ao criar um evento novo,
 * atualize os DOIS lados.
 */
export interface RealtimeServerToClientEvents {
  "joined-page-database": (payload: { pageId: string }) => void;
  "page-database-denied": (payload: { pageId: string }) => void;
  "page-presence": (payload: PresencePayload) => void;
  "cell-updated": (payload: CellUpdatedPayload) => void;
  "row-updated": (payload: RowUpdatedPayload) => void;
  "column-updated": (payload: ColumnUpdatedPayload) => void;
  "view-updated": (payload: ViewUpdatedPayload) => void;
  "row-created": (payload: RowPayload) => void;
  "row-deleted": (payload: RowPayload) => void;
}

export interface RealtimeClientToServerEvents {
  "join-page-database": (payload: { pageId: string }) => void;
  "leave-page-database": (payload: { pageId: string }) => void;
}

class RealtimeService {
  private io: CubsSocketServer | null = null;

  /** Chamado pelo SocketServer depois do attach — o io já autenticado. */
  initialize(io: CubsSocketServer): void {
    this.io = io;
  }

  /** Registra os comandos de sala num socket recém-conectado. */
  registerHandlers(socket: CubsSocket): void {
    socket.on("join-page-database", async (payload) => {
      const pageId = readPageId(payload);
      if (!pageId) return;

      const allowed = await pageAccessController.canAccessPage(socket.data.userId, pageId);
      if (!allowed) {
        // Falha silenciosa para o resto da sala, explícita para quem pediu:
        // ninguém mais precisa saber que houve tentativa.
        socket.emit("page-database-denied", { pageId });
        return;
      }

      await socket.join(roomFor(pageId));
      socket.emit("joined-page-database", { pageId });
      this.broadcastPresence(pageId);
    });

    socket.on("leave-page-database", async (payload) => {
      const pageId = readPageId(payload);
      if (!pageId) return;
      await socket.leave(roomFor(pageId));
      this.broadcastPresence(pageId);
    });

    // Sair da conexão inteira também esvazia as salas — o socket.io remove o
    // membro sozinho, mas a presença precisa ser recontada DEPOIS disso.
    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room.startsWith(ROOM_PREFIX)) {
          const pageId = room.slice(ROOM_PREFIX.length);
          setImmediate(() => this.broadcastPresence(pageId));
        }
      }
    });
  }

  emitCellUpdated(payload: CellUpdatedPayload): void {
    this.emit(payload.pageId, "cell-updated", payload);
  }

  emitRowUpdated(payload: RowUpdatedPayload): void {
    this.emit(payload.pageId, "row-updated", payload);
  }

  emitColumnUpdated(payload: ColumnUpdatedPayload): void {
    this.emit(payload.pageId, "column-updated", payload);
  }

  emitViewUpdated(payload: ViewUpdatedPayload): void {
    this.emit(payload.pageId, "view-updated", payload);
  }

  emitRowCreated(payload: RowPayload): void {
    this.emit(payload.pageId, "row-created", payload);
  }

  emitRowDeleted(payload: RowPayload): void {
    this.emit(payload.pageId, "row-deleted", payload);
  }

  /** Quantos sockets estão olhando a página — prova visível da conexão. */
  private broadcastPresence(pageId: string): void {
    if (!this.io) return;
    const room = this.io.sockets.adapter.rooms.get(roomFor(pageId));
    this.emit(pageId, "page-presence", { pageId, count: room?.size ?? 0 });
  }

  /**
   * Emite para TODA a sala, inclusive quem originou. O filtro de eco fica no
   * client (por `originUserId`) de propósito: a mesma conta pode ter duas abas
   * abertas, e `socket.broadcast` só excluiria a aba que escreveu — a outra
   * ficaria desatualizada. Além disso a escrita entra por HTTP, então aqui nem
   * sempre existe o socket de origem para excluir.
   */
  private emit<E extends keyof RealtimeServerToClientEvents>(
    pageId: string,
    event: E,
    payload: Parameters<RealtimeServerToClientEvents[E]>[0],
  ): void {
    if (!this.io) return;
    // O par (event, payload) já está amarrado pela assinatura genérica acima —
    // o que o TS não consegue provar é a relação DEPOIS do `.to()`, cujo emit
    // é uma união de todas as assinaturas. Um cast, na fronteira, com o
    // contrato garantido do lado de fora.
    const room = this.io.to(roomFor(pageId)) as unknown as {
      emit: (event: string, payload: unknown) => void;
    };
    room.emit(event, payload);
  }
}

const ROOM_PREFIX = "page-database:";

/** Nome técnico da sala — separado do nome do evento de propósito. */
function roomFor(pageId: string): string {
  return `${ROOM_PREFIX}${pageId}`;
}

/** Aceita `{ pageId }` (o contrato) e ignora qualquer outra forma. */
function readPageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const pageId = (payload as { pageId?: unknown }).pageId;
  return typeof pageId === "string" && pageId.length > 0 ? pageId : null;
}

// Singleton: as rotas importam e emitem direto, sem conhecer socket.io.
export default new RealtimeService();
