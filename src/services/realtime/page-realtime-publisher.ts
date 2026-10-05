import pageHierarchyStore from "@/repositories/page-hierarchy-repository";
import { readPageLatestUpdatedAt } from '@/repositories/page-activity';
import { sanitizeViewSnapshot } from '@/services/pages/views/page-query-serialization';
import type { ColumnPayload, RowPayload } from "@/services/realtime/contracts/realtime-contract-v1";
import {
  pageEditChannel,
} from "@/services/realtime/page-edit-channel";
import { RealtimeEventFactory } from "@/services/realtime/realtime-event-factory";
import type { RealtimeEventMetadata } from "@/services/realtime/types/realtime-event.types";
import type {
  CellUpdatedInput,
  ColumnChangedInput,
  ColumnCreatedInput,
  ColumnResetInput,
  ColumnUpdatedInput,
  DatabaseActivityReader,
  PageChangedInput,
  PageEditEmitter,
  ParentPageResolver,
  PublishMetadataInput,
  RealtimePublisherLogger,
  RowChangedInput,
} from "@/services/realtime/types/page-realtime-publisher.types";
export type {
  CellUpdatedInput,
  ColumnChangedInput,
  ColumnCreatedInput,
  ColumnResetInput,
  ColumnUpdatedInput,
  DatabaseActivityReader,
  PageChangedInput,
  PageEditEmitter,
  ParentPageResolver,
  PublishMetadataInput,
  RealtimePublisherLogger,
  RowChangedInput,
} from "@/services/realtime/types/page-realtime-publisher.types";

/**
 * Fronteira usada pelas rotas depois do commit. Ela conhece o roteamento de
 * dominio, mas nao importa Socket.IO nem expoe rooms/event names aos callers.
 */
export class PageRealtimePublisher {
  constructor(
    private readonly emitter: PageEditEmitter,
    private readonly parents: ParentPageResolver = pageHierarchyStore,
    private readonly factory: RealtimeEventFactory = new RealtimeEventFactory(),
    private readonly log: RealtimePublisherLogger = (message, error) => {
      console.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
    },
    private readonly activity: DatabaseActivityReader = { getUpdatedAt: readPageLatestUpdatedAt },
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
    await this.emitDatabaseUpdated(pageId, input.originUserId);
  }

  /**
   * Um unico relogio alimenta o chrome da propria pagina e a linha exibida na
   * parent. Falha num broadcast nao impede a tentativa do outro.
   */
  async pageChanged(input: PageChangedInput): Promise<void> {
    const metadata = this.metadata(input);
    if (input.data !== undefined || input.title !== undefined) {
      await this.emitDatabaseUpdated(input.pageId, input.originUserId);
    }
    if (input.data !== undefined) {
      this.safeEmit("view-updated", input.pageId, () =>
        this.emitter.emitViewUpdated(
          this.factory.create({ pageId: input.pageId, data: sanitizeViewSnapshot(input.data) }, metadata),
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
      await this.emitDatabaseUpdated(parentId, input.originUserId);
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
    await this.emitDatabaseUpdated(input.pageId, input.originUserId);
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
    await this.emitRowChange("row-created", input, (payload) => this.emitter.emitRowCreated(payload));
  }

  async rowOrderUpdated(pageId: string, viewId: string, rowId: string, orderRevision: number, originUserId: string): Promise<void> {
    const payload = this.factory.create({ pageId, viewId, rowId, orderRevision }, this.metadata({ originUserId }));
    this.safeEmit('row-order-updated', pageId, () => this.emitter.emitRowOrderUpdated?.(payload));
  }

  async rowDeleted(input: RowChangedInput): Promise<void> {
    await this.emitRowChange("row-deleted", input, (payload) => this.emitter.emitRowDeleted(payload));
  }

  async columnCreated(input: ColumnCreatedInput): Promise<void> {
    const metadata = this.metadata(input);
    await this.emitDatabaseUpdated(input.pageId, input.originUserId);
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
    await this.emitColumnChange("column-deleted", input, (payload) =>
      this.emitter.emitColumnDeleted(payload),
    );
  }

  /** Coluna e todas as celulas resetadas compartilham exatamente o mesmo ISO. */
  async columnReset(input: ColumnResetInput): Promise<void> {
    const metadata = this.metadata(input);
    await this.emitDatabaseUpdated(input.pageId, input.originUserId);
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

  private async emitRowChange(
    event: "row-created" | "row-deleted",
    input: RowChangedInput,
    emit: (payload: RowPayload) => void,
  ): Promise<void> {
    const metadata = this.metadata(input);
    const payload = this.factory.create(
      { pageId: input.pageId, rowId: input.rowId },
      metadata,
    );
    await this.emitDatabaseUpdated(input.pageId, input.originUserId);
    this.safeEmit(event, input.pageId, () => emit(payload));
  }

  private async emitColumnChange(
    event: "column-deleted",
    input: ColumnChangedInput,
    emit: (payload: ColumnPayload) => void,
  ): Promise<void> {
    const metadata = this.metadata(input);
    const payload = this.factory.create(
      { pageId: input.pageId, columnId: input.columnId },
      metadata,
    );
    await this.emitDatabaseUpdated(input.pageId, input.originUserId);
    this.safeEmit(event, input.pageId, () => emit(payload));
  }

  private metadata(input: PublishMetadataInput): RealtimeEventMetadata {
    return this.factory.metadata(input.originUserId);
  }

  private async emitDatabaseUpdated(pageId: string, originUserId: string): Promise<void> {
    try {
      const updatedAt = await this.activity.getUpdatedAt(pageId);
      if (!updatedAt) return;
      this.safeEmit("database-updated", pageId, () =>
        this.emitter.emitDatabaseUpdated({ pageId, updatedAt, originUserId }),
      );
    } catch (error) {
      this.log(`[cubs:realtime] Falha ao ler a ultima edicao da pagina ${pageId}`, error);
    }
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

export const pageRealtimePublisher = new PageRealtimePublisher(
  pageEditChannel,
);

export default pageRealtimePublisher;
