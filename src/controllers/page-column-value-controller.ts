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
  ) {}

  async createValue(input: Input.CreatePageColumnValue): Promise<ServiceResult<Schema.DecodedColumnValue>> {
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
      if (column.type === "flow") {
        return { ok: false, reason: "validation", message: "Resultado de flow só pode ser alterado pela execução" };
      }

      // A célula é única por (página, coluna); criação nunca substitui valor.
      const occupied = await this.cells.findCell(input.page_id, input.page_column_id);
      if (occupied) {
        return { ok: false, reason: "conflict", message: "Valor já existe para esta coluna nesta página" };
      }

      let data: string;
      try {
        data = this.values.encode(column, input);
      } catch (error) {
        return this.validationFailure(error);
      }

      const created = await this.cells.createCell({
        pageId: input.page_id,
        columnId: input.page_column_id,
        data,
      });
      if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: this.values.decode(created, column) };
    } catch (error) {
      return this.serverFailure(error);
    }
  }

  async updateValue(
    pageId: NonEmptyString,
    columnId: NonEmptyString,
    input: Input.UpdatePageColumnValue,
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
      if (column.type === "flow") {
        return { ok: false, reason: "validation", message: "Resultado de flow só pode ser alterado pela execução" };
      }

      let data: string;
      try {
        data = this.values.encode(column, input);
      } catch (error) {
        return this.validationFailure(error);
      }

      const updated = await this.cells.updateCell({
        cellId: existing.id,
        pageId,
        data,
      });
      if (!updated) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: this.values.decode(updated, column) };
    } catch (error) {
      return this.serverFailure(error);
    }
  }

  async getValue(
    pageId: NonEmptyString,
    columnId: NonEmptyString,
  ): Promise<ServiceResult<Schema.DecodedColumnValue>> {
    try {
      const row = await this.cells.findCell(pageId, columnId);
      if (!row) {
        return { ok: false, reason: "not_found", message: `"Page_column_value" não encontrado` };
      }

      const column = await this.cells.findColumnForCell(pageId, columnId);
      if (!column || !this.values.supports(column)) {
        return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
      }

      return { ok: true, data: this.values.decode(row, column) };
    } catch (error) {
      return this.serverFailure(error);
    }
  }

  async deleteValue(pageId: NonEmptyString, columnId: NonEmptyString): Promise<ServiceResult<{ type: Schema.ColumnType }>> {
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
      if (column.type === "flow") {
        return { ok: false, reason: "validation", message: "Resultado de flow só pode ser alterado pela execução" };
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

  private serverFailure(error: unknown): ServiceFailure {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
    return { ok: false, reason: "server_error", message: "Erro no servidor" };
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageColumnValueController();
