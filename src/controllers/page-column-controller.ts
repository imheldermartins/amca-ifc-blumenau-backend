import formulas from "@/repositories/page-formula-repository";
import relationWrites from "@/repositories/page-relation-write-repository";
import {withPageRowOrderLock} from '@/repositories/page-view-row-order';
import {bindScheduleDateColumn, scheduleDateColumnId} from '@/repositories/schedule-date-column';
import {ulid} from 'ulid';
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
import pageRelationRepository, {
  PageRelationError,
  type PageRelationRepository,
} from "@/repositories/page-relation-repository";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Erro no servidor";

type ColumnWriteResult = ServiceResult<Schema.PageColumn> & {
  relatedColumn?: Schema.PageColumn;
  relatedColumnCreated?: boolean;
};
/**
 * Orquestra o ciclo de vida de definições de coluna. Validação e normalização
 * da configuração pertencem aos serviços de domínio de columns; o controller
 * coordena contexto, persistência e efeitos transacionais da página parent.
 */
export class PageColumnController {
  private readonly columns = db.pageColumns;

  public constructor(
    private readonly configuration: PageColumnConfigurationService = pageColumnConfigurationService,
    private readonly relations: PageRelationRepository = pageRelationRepository,
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

  public async ensureCalendarDate(parentId: NonEmptyString, actorId: string): Promise<ColumnWriteResult & {reused?: boolean}> {
    return withPageRowOrderLock(parentId, async () => {
      const columns = await this.listColumns({parent_id: parentId} as LookupsConfig<Schema.PageColumn>);
      if (!columns) return {ok: false, reason: 'server_error', message: 'Não foi possível carregar as propriedades'};
      const parent = await db.pages.find({id: parentId} as LookupValues<Schema.Page>);
      const trackedId = scheduleDateColumnId(parent?.data);
      if (trackedId !== undefined) {
        const tracked = columns.find(column => column.id === trackedId);
        return tracked?.type === 'date' ? {ok: true, data: tracked, reused: true}
          : {ok: false, reason: 'conflict', message: 'A propriedade vinculada à Agenda foi removida ou deixou de ser uma data. O vínculo não foi substituído.'};
      }
      const existing = columns.find(column => column.data?.publicKey?.key === 'agendado_para'
        || column.data?.publicKey?.aliases?.includes('agendado_para')
        || (!column.data?.publicKey && normalizePublicKey(column.name, 'coluna') === 'agendado_para'));
      if (existing?.type !== undefined && existing.type !== 'date') return {ok: false, reason: 'conflict', message: 'A chave Agendado para já pertence a uma propriedade de outro tipo.'};
      if (existing) {
        try {await bindScheduleDateColumn(parentId, existing.id, actorId)}
        catch {return {ok: false, reason: 'conflict', message: 'Não foi possível vincular a propriedade da Agenda. Reabra a modal para atualizar.'}}
        return {ok: true, data: existing, reused: true};
      }
      if (collectPageColumnReservations(parent?.data).has('agendado_para')) {
        return {ok: false, reason: 'conflict', message: 'A chave Agendado para está reservada por uma propriedade removida ou pelo título da página.'};
      }
      const result = await this.createColumn({parent_id: parentId, name: 'Agendado para', type: 'date'}, actorId);
      if (!result.ok) return result;
      try {await bindScheduleDateColumn(parentId, result.data.id, actorId)}
      catch {return {ok: false, reason: 'conflict', message: 'A propriedade foi criada, mas não foi possível vinculá-la à Agenda. Tente novamente.'}}
      return result;
    });
  }

  public async createColumn(
    input: Input.CreatePageColumn,
    actorUserId?: string,
  ): Promise<ColumnWriteResult> {
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
      if (type === "relation") {
        if (!data.relation || !input.parent_id || !actorUserId) throw new Error("Configuração de Relação obrigatória");
        await this.relations.validateRelationConfig(input.parent_id, data.relation, actorUserId);
      }
      if (type === "extract_as") {
        if (!data.rollup || !input.parent_id || !actorUserId) throw new Error("Configuração de Resumo obrigatória");
        data.rollupResult = await this.relations.validateRollupConfig(input.parent_id, data.rollup, actorUserId);
      }
      if (type === 'formula' || input.formula !== undefined) {
        if (!input.parent_id || !actorUserId) throw new Error('Contexto da fórmula obrigatório');
        data.formula = await formulas.definition(input.parent_id, actorUserId, input.formula);
      }
      // rollupResult é um DTO resolvido; nunca faz parte da persistência.
      delete data.rollupResult;
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
      if (error instanceof PageRelationError && error.status === 403) {
        return { ok: false, reason: "forbidden", message: error.message };
      }
      return { ok: false, reason: "validation", message: messageOf(error) };
    }

    try {
      const column: CreateValues<Schema.PageColumn> = {
        name,
        type,
        data,
        parent_id: input.parent_id ?? null,
      };
      const relationResult = type === 'relation' && actorUserId
        ? await relationWrites.saveDefinition(null, {id: ulid() as NonEmptyString, name, type, data, parent_id: input.parent_id ?? null}, input.relation, actorUserId)
        : undefined;
      const created = relationResult ? relationResult.column : await this.columns.create(column, {
        after: input.parent_id ? [pageActivityTouchStatement(input.parent_id)] : [],
      });

      if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      const [resolved] = actorUserId
        ? await this.relations.resolveColumnMetadata([created], actorUserId)
        : [created];
      return { ok: true, data: resolved ?? created,
        ...(relationResult?.inverse && {relatedColumn: relationResult.inverse, relatedColumnCreated: Boolean(relationResult.inverseCreated)}) };
    } catch (error) {
      if (error instanceof PageRelationError) return {ok: false, reason: error.status === 403 ? 'forbidden' : 'conflict', message: error.message};
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  // `lookup` permite escopar a coluna (ex.: { id, parent_id }) -- assim a rota
  // aninhada não altera coluna de outra página parent.
  public async updateColumn(
    lookup: LookupValues<Schema.PageColumn>,
    input: Input.UpdatePageColumn,
    actorUserId?: string,
  ): Promise<ColumnWriteResult> {
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
      input.mask !== undefined ||
      input.relation !== undefined ||
      input.rollup !== undefined || input.formula !== undefined;
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
      if (existing.type === "relation" && effectiveType !== "relation") {
        await this.relations.assertNoDependentRollups(existing.id);
        if (existing.data.relation?.inverseColumnId) throw new PageRelationError(409, 'Desative a relação bidirecional antes de trocar o tipo');
      }
      if (effectiveType === "relation") {
        if (!nextData.relation || !existing.parent_id || !actorUserId) throw new Error("Configuração de Relação obrigatória");
        await this.relations.assertRelationCanChange(existing.id, nextData.relation.targetDatabaseId);
        await this.relations.validateRelationConfig(existing.parent_id, nextData.relation, actorUserId);
      }
      if (effectiveType === "extract_as") {
        if (!nextData.rollup || !existing.parent_id || !actorUserId) throw new Error("Configuração de Resumo obrigatória");
        nextData.rollupResult = await this.relations.validateRollupConfig(existing.parent_id, nextData.rollup, actorUserId);
      }
      delete nextData.rollupResult;
      if (input.formula !== undefined || (effectiveType === 'formula' && existing.type !== 'formula')) {
        if (!existing.parent_id || !actorUserId) throw new Error('Contexto da fórmula obrigatório');
        nextData.formula = await formulas.definition(existing.parent_id, actorUserId, input.formula, existing.id, existing.data.formula);
      }
      if (effectiveType === 'formula' && !nextData.formula) throw new Error('Configure uma fórmula válida');
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
      if (error instanceof PageRelationError && error.status === 409) {
        return { ok: false, reason: "conflict", message: error.message };
      }
      if (error instanceof PageRelationError && error.status === 403) {
        return { ok: false, reason: "forbidden", message: error.message };
      }
      return { ok: false, reason: "validation", message: messageOf(error) };
    }

    // Nada para atualizar: no-op, devolve o registro atual.
    if (Object.keys(payload).length === 0 && input.relation === undefined) return { ok: true, data: existing };

    try {
      const relationResult = effectiveType === 'relation' && actorUserId
        ? await relationWrites.saveDefinition(existing, {...existing, ...payload} as Schema.PageColumn, input.relation, actorUserId)
        : undefined;
      const updated = relationResult ? true : existing.type === 'formula' || effectiveType === 'formula' || input.formula !== undefined
        ? await formulas.compareAndUpdate(existing, payload)
        : await this.columns.update(payload, lookup, {
        after: existing.parent_id ? [pageActivityTouchStatement(existing.parent_id)] : [],
      });
      if (!updated) return { ok: false, reason: "conflict", message: "A coluna foi alterada. Reabra o editor para continuar." };

      const column = await this.columns.find(lookup);
      if (!column) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      const [resolved] = actorUserId
        ? await this.relations.resolveColumnMetadata([column], actorUserId)
        : [column];
      return { ok: true, data: resolved ?? column,
        ...(relationResult?.inverse && {relatedColumn: relationResult.inverse, relatedColumnCreated: Boolean(relationResult.inverseCreated)}) };
    } catch (error) {
      if (error instanceof PageRelationError) return {ok: false, reason: error.status === 403 ? 'forbidden' : 'conflict', message: error.message};
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
      if (existing.type === "relation") await this.relations.assertNoDependentRollups(existing.id);
      if (existing.type === 'relation' && existing.data.relation?.inverseColumnId) {
        throw new PageRelationError(409, 'Desative a relação bidirecional antes de excluir a propriedade');
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
      if (error instanceof PageRelationError && error.status === 409) {
        return { ok: false, reason: "conflict", message: error.message };
      }
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageColumnController();
