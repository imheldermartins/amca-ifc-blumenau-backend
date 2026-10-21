import formulas from "@/repositories/page-formula-repository";
import relationWrites from "@/repositories/page-relation-write-repository";
import pageCellStore from "@/repositories/page-cell-repository";
import type { PageCellStoreContract } from "@/repositories/types/page-cell-repository.types";
import type {
  ServiceFailure,
  ServiceResult,
} from "@/controllers/types/service-result.types";
import type { Input } from "@/db/schemas/inputs";
import type { Schema } from "@/db/schemas/index";
import pageCellValueMapper from "@/services/page-cell-value-mapper";
import type { PageCellValueMapperContract } from "@/services/types/page-cell-value-mapper.types";
import pageRelationRepository, {
  PageRelationError,
  type PageRelationRepository,
} from '@/repositories/page-relation-repository';

/**
 * Casos de uso da célula identificada por (page_id, page_column_id).
 *
 * O controller coordena a ordem das invariantes e traduz falhas para o contrato
 * da aplicação. Relação row/column e transações ficam no PageCellStore; a
 * transformação entre payload, codec e resposta fica no PageCellValueMapper.
 * Não há CRUD bruto capaz de ignorar essas duas fronteiras.
 */
export class PageColumnValueController {
  public constructor(
    private readonly cells: PageCellStoreContract = pageCellStore,
    private readonly values: PageCellValueMapperContract = pageCellValueMapper,
    private readonly relations: PageRelationRepository = pageRelationRepository,
  ) {}

  async createValue(input: Input.CreatePageColumnValue, actorUserId?: string): Promise<ServiceResult<Schema.DecodedColumnValue>> {
    if (!input?.page_column_id) {
      return { ok: false, reason: "validation", message: "page_column_id é obrigatório" };
    }
    if (!input?.page_id) {
      return { ok: false, reason: "validation", message: "page_id é obrigatório" };
    }

    try {
      const column = await this.cells.findColumnForCell(input.page_id, input.page_column_id);
      if (!column) {
        return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
      }
      if (!this.values.supports(column)) {
        return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
      }
      if (column.type === "formula" || column.type === "flow" || column.type === "extract_as") {
        return { ok: false, reason: "validation", message: column.type !== 'flow' ? 'Resumo é uma coluna calculada e somente leitura' : "Resultado de flow só pode ser alterado pela execução" };
      }

      // A célula é única por (página, coluna); criação nunca substitui valor.
      const occupied = await this.cells.findCell(input.page_id, input.page_column_id);
      if (occupied) {
        return { ok: false, reason: "conflict", message: "Valor já existe para esta coluna nesta página" };
      }

      let data: string;
      let relationTargets: string[] | undefined;
      try {
        if (column.type === 'relation' && !Array.isArray(input.value)) throw new Error('Valor de Relação inválido');
        relationTargets = column.type === 'relation'
          ? await this.relations.prepareRelationTargets(column, input.page_id, input.value as string[], actorUserId ?? '')
          : undefined;
        data = this.values.encode(column, relationTargets ? { ...input, value: relationTargets } : input);
      } catch (error) {
        return this.domainFailure(error);
      }

      const created = relationTargets
        ? await relationWrites.write(column, input.page_id, relationTargets, actorUserId ?? '', null)
        : await this.cells.createCell({
        pageId: input.page_id,
        columnId: input.page_column_id,
        data,
      });
      if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: await this.decodeForActor(created, column, actorUserId) };
    } catch (error) {
      return this.serverFailure(error);
    }
  }

  async updateValue(
    pageId: NonEmptyString,
    columnId: NonEmptyString,
    input: Input.UpdatePageColumnValue,
    actorUserId?: string,
  ): Promise<ServiceResult<Schema.DecodedColumnValue>> {
    try {
      const existing = await this.cells.findCell(pageId, columnId);
      if (!existing) {
        return { ok: false, reason: "not_found", message: `"Page_column_value" não encontrado` };
      }

      const column = await this.cells.findColumnForCell(pageId, columnId);
      if (!column) {
        return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
      }
      if (!this.values.supports(column)) {
        return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
      }
      if (column.type === "formula" || column.type === "flow" || column.type === "extract_as") {
        return { ok: false, reason: "validation", message: column.type !== 'flow' ? 'Resumo é uma coluna calculada e somente leitura' : "Resultado de flow só pode ser alterado pela execução" };
      }

      let data: string;
      let relationTargets: string[] | undefined;
      try {
        if (column.type === 'relation' && !Array.isArray(input.value)) throw new Error('Valor de Relação inválido');
        relationTargets = column.type === 'relation'
          ? await this.relations.prepareRelationTargets(column, pageId, input.value as string[], actorUserId ?? '')
          : undefined;
        data = this.values.encode(column, relationTargets ? { ...input, value: relationTargets } : input);
      } catch (error) {
        return this.domainFailure(error);
      }

      const updated = relationTargets
        ? await relationWrites.write(column, pageId, relationTargets, actorUserId ?? '', existing)
        : await this.cells.updateCell({
        cellId: existing.id,
        pageId,
        data,
      });
      if (!updated) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: await this.decodeForActor(updated, column, actorUserId) };
    } catch (error) {
      return this.serverFailure(error);
    }
  }

  async getValue(
    pageId: NonEmptyString,
    columnId: NonEmptyString,
    actorUserId?: string,
  ): Promise<ServiceResult<Schema.DecodedColumnValue>> {
    try {
      const computed = await this.cells.findColumnForCell(pageId, columnId);
      if (computed?.type === 'formula' && computed.parent_id && actorUserId) {
        const results = await formulas.evaluate(computed.parent_id, computed.data.formula?.source ?? '', columnId, [pageId], actorUserId);
        const result = results[pageId];
        return {ok:true,data:{id:columnId,page_id:pageId,page_column_id:columnId,type:'formula',value:result?.ok ? result.value : {kind:'formula-error',message:result?.error.message ?? 'Fórmula indisponível'}}};
      }
      const row = await this.cells.findCell(pageId, columnId);
      if (!row) {
        return { ok: false, reason: "not_found", message: `"Page_column_value" não encontrado` };
      }

      const column = await this.cells.findColumnForCell(pageId, columnId);
      if (!column || !this.values.supports(column)) {
        return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
      }

      return { ok: true, data: await this.decodeForActor(row, column, actorUserId) };
    } catch (error) {
      return this.serverFailure(error);
    }
  }

  async deleteValue(pageId: NonEmptyString, columnId: NonEmptyString, actorUserId?: string): Promise<ServiceResult<{ type: Schema.ColumnType }>> {
    try {
      const row = await this.cells.findCell(pageId, columnId);
      if (!row) {
        return { ok: false, reason: "not_found", message: `"Page_column_value" não encontrado` };
      }

      // A coluna precisa pertencer à parent DIRETA da página-linha. Sem esta
      // checagem, qualquer columnId conhecido podia ser combinado com uma row
      // acessível e apagar uma célula cruzada entre duas databases.
      const column = await this.cells.findColumnForCell(pageId, columnId);
      if (!column) {
        return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
      }
      if (column.type === "formula" || column.type === "flow" || column.type === "extract_as") {
        return { ok: false, reason: "validation", message: column.type !== 'flow' ? 'Resumo é uma coluna calculada e somente leitura' : "Resultado de flow só pode ser alterado pela execução" };
      }

      if (column.type === 'relation') {
        const remaining = await this.relations.prepareRelationTargets(column, pageId, [], actorUserId ?? '');
        await relationWrites.write(column, pageId, remaining, actorUserId ?? '', row, true);
        return {ok: true, data: {type: column.type}};
      }
      const deleted = await this.cells.deleteCell(row.id, pageId);
      if (!deleted) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: { type: column.type } };
    } catch (error) {
      return this.serverFailure(error);
    }
  }

  private validationFailure(error: unknown): ServiceFailure {
    return {
      ok: false,
      reason: "validation",
      message: error instanceof Error ? error.message : "Erro no servidor",
    };
  }

  private async decodeForActor(
    row: Schema.PageColumnValue,
    column: Schema.PageColumn,
    actorUserId?: string,
  ): Promise<Schema.DecodedColumnValue> {
    const decoded = this.values.decode(row, column);
    if (column.type !== 'relation') return decoded;
    const ids = Array.isArray(decoded.value)
      ? decoded.value.filter((id): id is string => typeof id === 'string')
      : [];
    if (!actorUserId || ids.length === 0) return { ...decoded, value: [] };
    const visible = await this.relations.resolveVisibleTargets(ids, actorUserId);
    return { ...decoded, value: ids.filter((id) => visible[id]) };
  }

  private domainFailure(error: unknown): ServiceFailure {
    if (error instanceof PageRelationError) {
      return {
        ok: false,
        reason: error.status === 409 ? 'conflict' : error.status === 403 ? 'forbidden' : error.status === 404 ? 'not_found' : 'validation',
        message: error.message,
      };
    }
    return this.validationFailure(error);
  }

  private serverFailure(error: unknown): ServiceFailure {
    if (error instanceof PageRelationError) return this.domainFailure(error);
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
    return { ok: false, reason: "server_error", message: "Erro no servidor" };
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageColumnValueController();
