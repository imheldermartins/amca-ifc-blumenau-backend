import pageAccessController from "@/controllers/page-access-controller";
import type {
  CellUpdatedPayload,
  ColumnCreatedPayload,
  ColumnPayload,
  ColumnUpdatedPayload,
  PageUpdatedPayload,
  RowPayload,
  RowUpdatedPayload,
  ViewUpdatedPayload,
} from "@core/socket/realtime-contract-v1";
import {
  pageEditChannel,
} from "@core/socket/page-edit-channel";
import {
  RealtimeEventFactory,
  type RealtimeEventMetadata,
} from "@core/socket/realtime-event-factory";

export interface ParentPageResolver {
  getParentId(pageId: string): Promise<string | null>;
}

export interface PageEditEmitter {
  emitCellUpdated(payload: CellUpdatedPayload): void;
  emitRowUpdated(payload: RowUpdatedPayload): void;
  emitPageUpdated(payload: PageUpdatedPayload): void;
  emitColumnUpdated(payload: ColumnUpdatedPayload): void;
  emitViewUpdated(payload: ViewUpdatedPayload): void;
  emitRowCreated(payload: RowPayload): void;
  emitRowDeleted(payload: RowPayload): void;
  emitColumnCreated(payload: ColumnCreatedPayload): void;
  emitColumnDeleted(payload: ColumnPayload): void;
}

export interface PublishMetadataInput {
  /** Sempre deve vir de `req.userId`, nunca do body HTTP. */
  originUserId: string;
}

export interface CellUpdatedInput extends PublishMetadataInput {
  rowId: string;
  columnId: string;
  value: unknown;
}

export interface PageChangedInput extends PublishMetadataInput {
  pageId: string;
  title?: string | null;
  data?: unknown;
}

export interface ColumnUpdatedInput extends PublishMetadataInput {
  pageId: string;
  columnId: string;
  column: unknown;
}

export interface RowChangedInput extends PublishMetadataInput {
  /** Pagina parent cuja room observa a linha. */
  pageId: string;
  rowId: string;
}

export interface ColumnChangedInput extends PublishMetadataInput {
  /** Pagina dona da coluna. */
  pageId: string;
  columnId: string;
}

export interface ColumnCreatedInput extends ColumnChangedInput {
  /** Definicao devolvida pelo commit da rota. */
  column: unknown;
}

export interface ColumnResetInput extends ColumnUpdatedInput {
  cells: readonly { rowId: string; value: unknown }[];
}

export type RealtimePublisherLogger = (message: string, error: unknown) => void;

/**
 * Fronteira usada pelas rotas depois do commit. Ela conhece o roteamento de
 * dominio, mas nao importa Socket.IO nem expoe rooms/event names aos callers.
 */
export class PageRealtimePublisher {
  constructor(
    private readonly emitter: PageEditEmitter,
    private readonly parents: ParentPageResolver = pageAccessController,
    private readonly factory: RealtimeEventFactory = new RealtimeEventFactory(),
    private readonly log: RealtimePublisherLogger = defaultLogger,
  ) {}

  /** Resolve a room parent da linha depois que a celula foi confirmada. */
  async cellUpdated(input: CellUpdatedInput): Promise<void> {
    const pageId = await this.resolveParent(input.rowId, "cell-updated");
    if (!pageId) return;
    const metadata = this.metadata(input);
    this.safeEmit("cell-updated", pageId, () =>
      this.emitter.emitCellUpdated(
        this.factory.create(
          {
            pageId,
            rowId: input.rowId,
            columnId: input.columnId,
            value: input.value,
          },
          metadata,
        ),
      ),
    );
  }

  /**
   * Um unico relogio alimenta o chrome da propria pagina e a linha exibida na
   * parent. Falha num broadcast nao impede a tentativa do outro.
   */
  async pageChanged(input: PageChangedInput): Promise<void> {
    const metadata = this.metadata(input);
    if (input.data !== undefined) {
      this.safeEmit("view-updated", input.pageId, () =>
        this.emitter.emitViewUpdated(
          this.factory.create({ pageId: input.pageId, data: input.data }, metadata),
        ),
      );
    }

    if (input.title !== undefined) {
      this.safeEmit("page-updated", input.pageId, () =>
        this.emitter.emitPageUpdated(
          this.factory.create({ pageId: input.pageId, title: input.title ?? null }, metadata),
        ),
      );

      const parentId = await this.resolveParent(input.pageId, "row-updated");
      if (!parentId) return;
      this.safeEmit("row-updated", parentId, () =>
        this.emitter.emitRowUpdated(
          this.factory.create(
            { pageId: parentId, rowId: input.pageId, title: input.title ?? null },
            metadata,
          ),
        ),
      );
    }
  }

  async columnUpdated(input: ColumnUpdatedInput): Promise<void> {
    const metadata = this.metadata(input);
    this.safeEmit("column-updated", input.pageId, () =>
      this.emitter.emitColumnUpdated(
        this.factory.create(
          { pageId: input.pageId, columnId: input.columnId, column: input.column },
          metadata,
        ),
      ),
    );
  }

  async rowCreated(input: RowChangedInput): Promise<void> {
    this.emitRowChange("row-created", input, (payload) => this.emitter.emitRowCreated(payload));
  }

  async rowDeleted(input: RowChangedInput): Promise<void> {
    this.emitRowChange("row-deleted", input, (payload) => this.emitter.emitRowDeleted(payload));
  }

  async columnCreated(input: ColumnCreatedInput): Promise<void> {
    const metadata = this.metadata(input);
    this.safeEmit("column-created", input.pageId, () =>
      this.emitter.emitColumnCreated(
        this.factory.create(
          { pageId: input.pageId, columnId: input.columnId, column: input.column },
          metadata,
        ),
      ),
    );
  }

  async columnDeleted(input: ColumnChangedInput): Promise<void> {
    this.emitColumnChange("column-deleted", input, (payload) =>
      this.emitter.emitColumnDeleted(payload),
    );
  }

  /** Coluna e todas as celulas resetadas compartilham exatamente o mesmo ISO. */
  async columnReset(input: ColumnResetInput): Promise<void> {
    const metadata = this.metadata(input);
    this.safeEmit("column-updated", input.pageId, () =>
      this.emitter.emitColumnUpdated(
        this.factory.create(
          { pageId: input.pageId, columnId: input.columnId, column: input.column },
          metadata,
        ),
      ),
    );

    for (const cell of input.cells) {
      this.safeEmit("cell-updated", input.pageId, () =>
        this.emitter.emitCellUpdated(
          this.factory.create(
            {
              pageId: input.pageId,
              rowId: cell.rowId,
              columnId: input.columnId,
              value: cell.value,
            },
            metadata,
          ),
        ),
      );
    }
  }

  private emitRowChange(
    event: "row-created" | "row-deleted",
    input: RowChangedInput,
    emit: (payload: RowPayload) => void,
  ): void {
    const payload = this.factory.create(
      { pageId: input.pageId, rowId: input.rowId },
      this.metadata(input),
    );
    this.safeEmit(event, input.pageId, () => emit(payload));
  }

  private emitColumnChange(
    event: "column-deleted",
    input: ColumnChangedInput,
    emit: (payload: ColumnPayload) => void,
  ): void {
    const payload = this.factory.create(
      { pageId: input.pageId, columnId: input.columnId },
      this.metadata(input),
    );
    this.safeEmit(event, input.pageId, () => emit(payload));
  }

  private metadata(input: PublishMetadataInput): RealtimeEventMetadata {
    return this.factory.metadata(input.originUserId);
  }

  private async resolveParent(rowId: string, event: string): Promise<string | null> {
    try {
      return await this.parents.getParentId(rowId);
    } catch (error) {
      this.log(
        `[cubs:realtime] Falha ao resolver parent para ${event} da pagina ${rowId}`,
        error,
      );
      return null;
    }
  }

  private safeEmit(event: string, pageId: string, emit: () => void): void {
    try {
      emit();
    } catch (error) {
      // A escrita HTTP ja foi commitada: broadcast best-effort nunca reverte
      // nem transforma sucesso persistido em erro para o cliente.
      this.log(`[cubs:realtime] Falha ao publicar ${event} na pagina ${pageId}`, error);
    }
  }
}

function defaultLogger(message: string, error: unknown): void {
  console.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
}

export const pageRealtimePublisher = new PageRealtimePublisher(
  pageEditChannel,
);

export default pageRealtimePublisher;
