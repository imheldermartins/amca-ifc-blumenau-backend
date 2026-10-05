import db from "@models/index";
import type { Schema } from "@/db/schemas/index";
import type { Input } from "@/db/schemas/inputs";
import { buildUpdatePageJsonPathsStatement } from "@/repositories/page-json";
import {
  FILTER_KEY_REGISTRY_DATA_KEY,
  appendDeletedColumnKeys,
  collectPageColumnReservations,
} from "@/services/filter-key-registry";
import {
  allocateDuplicateLabel,
  collectReservedPublicKeys,
  normalizePublicKey,
  reconcilePublicKeyMetadata,
} from "@/services/public-key";
import { pageActivityTouchStatement } from "@/repositories/page-activity";
import type { ServiceResult } from "@/controllers/types/service-result.types";
import pageColumnConfigurationService, {
  type PageColumnConfigurationService,
} from "@/services/pages/columns/page-column-configuration-service";
import { pageUsesFlowColumn } from "@/services/pages/views/page-view-parsers";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Erro no servidor";

/**
 * Orquestra o ciclo de vida de definições de coluna. Validação e normalização
 * da configuração pertencem aos serviços de domínio de columns; o controller
 * coordena contexto, persistência e efeitos transacionais da página parent.
 */
export class PageColumnController {
  private readonly columns = db.pageColumns;

  public constructor(
    private readonly configuration: PageColumnConfigurationService = pageColumnConfigurationService,
  ) {}

  public async listColumns(
    lookup?: LookupsConfig<Schema.PageColumn>,
  ): Promise<Schema.PageColumn[] | null> {
    try {
      const columns = await this.columns.findAll(lookup);

      if (!columns) throw new Error("No page columns found");

      return columns;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  public async getColumn(
    lookup: LookupValues<Schema.PageColumn>,
  ): Promise<Schema.PageColumn | null> {
    try {
      const column = await this.columns.find(lookup);

      if (!column) throw new Error("Page column not found");

      return column;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  public async createColumn(
    input: Input.CreatePageColumn,
  ): Promise<ServiceResult<Schema.PageColumn>> {
    const type = input?.type;
    if (!this.configuration.isColumnType(type)) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    let data: Schema.PageColumnData;
    let name = input.name ?? null;
    let siblings: Schema.PageColumn[] = [];
    let parent: Schema.Page | null = null;
    try {
      if (input.parent_id) {
        [siblings, parent] = await Promise.all([
          this.columns
            .findAll({ parent_id: input.parent_id } as LookupsConfig<Schema.PageColumn>)
            .then((columns) => columns ?? []),
          db.pages.find({ id: input.parent_id } as LookupValues<Schema.Page>),
        ]);
      }
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }

    try {
      if (typeof name === "string") {
        name = allocateDuplicateLabel(name, siblings.map((column) => column.name), 1);
      }

      // Parte da base do tipo e mescla o que vier no payload (whitelist).
      data = this.configuration.merge(this.configuration.base(type), input);
      data.publicKey = reconcilePublicKeyMetadata(
        name,
        "coluna",
        null,
        new Set([
          ...collectReservedPublicKeys(
            siblings.map((column) => ({
              id: column.id,
              label: column.name,
              publicKey: column.data?.publicKey,
            })),
            "coluna",
          ),
          ...collectPageColumnReservations(parent?.data),
        ]),
      );
    } catch (error) {
      return { ok: false, reason: "validation", message: messageOf(error) };
    }

    try {
      const column: CreateValues<Schema.PageColumn> = {
        name,
        type,
        data,
        parent_id: input.parent_id ?? null,
      };
      const created = await this.columns.create(column, {
        after: input.parent_id ? [pageActivityTouchStatement(input.parent_id)] : [],
      });

      if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: created };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  // `lookup` permite escopar a coluna (ex.: { id, parent_id }) -- assim a rota
  // aninhada não altera coluna de outra página parent.
  public async updateColumn(
    lookup: LookupValues<Schema.PageColumn>,
    input: Input.UpdatePageColumn,
  ): Promise<ServiceResult<Schema.PageColumn>> {
    let existing: Schema.PageColumn | null;
    try {
      existing = await this.columns.find(lookup);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
    if (!existing) {
      return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
    }

    const effectiveType = input.type ?? existing.type;
    if (!this.configuration.isColumnType(effectiveType)) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    const payload: UpdateValues<Schema.PageColumn> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.type !== undefined) payload.type = input.type;

    // O `data` é PARCIAL e ACUMULA: mescla o que vier com o `existing.data`, sem
    // apagar o config de outro tipo (a preservação da troca de tipo) e sem
    // deixar passar chave desconhecida (whitelist). Trocar SÓ o `type` não mexe
    // no data — o config antigo fica preservado para um eventual retrocesso.
    const hasConfig =
      input.flowButton !== undefined ||
      input.options !== undefined ||
      input.format !== undefined ||
      input.currency !== undefined ||
      input.mask !== undefined;
    let siblings: Schema.PageColumn[] = [];
    let parent: Schema.Page | null = null;
    try {
      if (existing.parent_id) {
        [siblings, parent] = await Promise.all([
          this.columns
            .findAll({ parent_id: existing.parent_id } as LookupsConfig<Schema.PageColumn>)
            .then((columns) => columns ?? []),
          db.pages.find({ id: existing.parent_id } as LookupValues<Schema.Page>),
        ]);
      }
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }

    if (
      existing.type === "flow" &&
      effectiveType !== "flow" &&
      pageUsesFlowColumn(parent?.data, existing.id)
    ) {
      return {
        ok: false,
        reason: "conflict",
        message: "A coluna Flow está vinculada a uma visualização de formulário",
      };
    }

    try {
      const nextData = hasConfig
        ? this.configuration.merge(existing.data, input)
        : this.configuration.merge(existing.data, {});
      const reserved = collectReservedPublicKeys(
        siblings
          .filter((column) => column.id !== existing.id)
          .map((column) => ({
            id: column.id,
            label: column.name,
            publicKey: column.data?.publicKey,
          })),
        "coluna",
      );
      collectPageColumnReservations(parent?.data).forEach((key) => reserved.add(key));
      const nextName = input.name !== undefined ? input.name : existing.name;
      nextData.publicKey = reconcilePublicKeyMetadata(
        nextName,
        "coluna",
        existing.data?.publicKey,
        reserved,
        {
          forceRename:
            input.name !== undefined &&
            normalizePublicKey(existing.name, "coluna") !== normalizePublicKey(nextName, "coluna"),
        },
      );
      if (JSON.stringify(nextData) !== JSON.stringify(existing.data)) payload.data = nextData;
    } catch (error) {
      return { ok: false, reason: "validation", message: messageOf(error) };
    }

    // Nada para atualizar: no-op, devolve o registro atual.
    if (Object.keys(payload).length === 0) return { ok: true, data: existing };

    try {
      const updated = await this.columns.update(payload, lookup, {
        after: existing.parent_id ? [pageActivityTouchStatement(existing.parent_id)] : [],
      });
      if (!updated) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      const column = await this.columns.find(lookup);
      if (!column) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: column };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  /** Envia uma coluna à lixeira sem permitir que sua URL pública seja reutilizada. */
  public async deleteColumn(
    lookup: LookupValues<Schema.PageColumn>,
  ): Promise<ServiceResult<Schema.PageColumn>> {
    try {
      const existing = await this.columns.find(lookup);
      if (!existing) {
        return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
      }

      const before: SqlStatement[] = [];
      if (existing.parent_id) {
        const page = await db.pages.find({ id: existing.parent_id } as LookupValues<Schema.Page>);
        if (!page) return { ok: false, reason: "not_found", message: "Página não encontrada" };
        if (pageUsesFlowColumn(page.data, existing.id)) {
          return {
            ok: false,
            reason: "conflict",
            message: "A coluna Flow está vinculada a uma visualização de formulário",
          };
        }
        const tombstones = appendDeletedColumnKeys(page.data, existing);
        before.push(buildUpdatePageJsonPathsStatement(existing.parent_id, [
          {
            path: [FILTER_KEY_REGISTRY_DATA_KEY, "columns"],
            value: tombstones,
          },
        ]));
      }

      const deleted = await this.columns.delete(lookup, {
        before,
      });
      if (!deleted) return { ok: false, reason: "server_error", message: "Erro no servidor" };
      return { ok: true, data: existing };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageColumnController();
