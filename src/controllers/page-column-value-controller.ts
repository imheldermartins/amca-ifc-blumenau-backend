import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { VALUE_CODECS } from "@/services/value-codec";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Erro no servidor";

/**
 * page_columns_values: este controller é a camada de service (padrão do repo) e
 * concentra TODA a transformação via ColumnValueCodec. O cliente envia/recebe o
 * valor "nu"; o banco guarda o envelope `{"value":<T>}` como string.
 *
 * A CÉLULA (page_id, page_column_id) tem no máximo UM valor — UNIQUE no banco.
 * As variantes *Value (createValue/getValue/updateValue/deleteValue) endereçam
 * a célula por esse par e devolvem o shape decodificado em ServiceResult (a
 * rota mapeia reason -> StatusCode; célula já preenchida no create -> conflict).
 * Os métodos do IBaseController são acesso BRUTO (não passam pelo codec) e
 * existem só para satisfazer o contrato -- a rota usa as variantes.
 */
class PageColumnValueController implements IBaseController<Schema.PageColumnValue> {
  private db: Model<Schema.PageColumnValue> = db.pageColumnValues;

  // --- IBaseController (acesso bruto; a rota usa as variantes com codec) ---

  async all(lookup?: LookupsConfig<Schema.PageColumnValue>) {
    try {
      const rows = await this.db.findAll(lookup);
      if (!rows) throw new Error("No page column values found");
      return rows;
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  async get(lookup: LookupValues<Schema.PageColumnValue>) {
    try {
      const row = await this.db.find(lookup);
      if (!row) throw new Error("Page column value not found");
      return row;
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  async create(data: CreateValues<Schema.PageColumnValue>) {
    try {
      const created = await this.db.create(data);
      if (!created) throw new Error("Failed to create page column value");
      return created;
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  async update(lookup: LookupValues<Schema.PageColumnValue>, data: UpdateValues<Schema.PageColumnValue>) {
    try {
      const updated = await this.db.update(data, lookup);
      if (!updated) throw new Error("Failed to update page column value");
      const row = await this.db.find(lookup);
      return row ?? null;
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  async delete(lookup: LookupValues<Schema.PageColumnValue>) {
    try {
      const deleted = await this.db.delete(lookup);
      if (!deleted) throw new Error("Failed to delete page column value");
      return deleted;
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return false;
    }
  }

  // --- Variantes com codec (usadas pela rota; retornam o valor decodificado) ---

  async createValue(input: Input.CreatePageColumnValue): Promise<ServiceResult<Schema.DecodedColumnValue>> {
    if (!input?.page_column_id) {
      return { ok: false, reason: "validation", message: "page_column_id é obrigatório" };
    }
    if (!input?.page_id) {
      return { ok: false, reason: "validation", message: "page_id é obrigatório" };
    }

    const column = await db.pageColumns.find(
      { id: input.page_column_id } as LookupValues<Schema.PageColumn>,
    );
    if (!column) {
      return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
    }

    const codec = VALUE_CODECS[column.type];
    if (!codec) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    // Célula já preenchida: o valor é único por (página, coluna) -- use PUT.
    const occupied = await this.findCell(input.page_id, input.page_column_id);
    if (occupied) {
      return { ok: false, reason: "conflict", message: "Valor já existe para esta coluna nesta página" };
    }

    let typed: unknown;
    try {
      typed = codec.validate(this.resolveRawValue(column, input), column);
    } catch (error) {
      return { ok: false, reason: "validation", message: messageOf(error) };
    }

    try {
      const data = codec.encode(typed);
      const created = await this.db.create({
        page_id: input.page_id,
        page_column_id: input.page_column_id,
        data,
      } as unknown as CreateValues<Schema.PageColumnValue>);

      if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: this.toDecoded(created, column) };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async updateValue(
    pageId: string,
    columnId: string,
    input: Input.UpdatePageColumnValue,
  ): Promise<ServiceResult<Schema.DecodedColumnValue>> {
    const existing = await this.findCell(pageId, columnId);
    if (!existing) {
      return { ok: false, reason: "not_found", message: `"Page_column_value" não encontrado` };
    }

    const column = await db.pageColumns.find({ id: columnId } as LookupValues<Schema.PageColumn>);
    if (!column) {
      return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
    }

    const codec = VALUE_CODECS[column.type];
    if (!codec) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    let typed: unknown;
    try {
      typed = codec.validate(this.resolveRawValue(column, input), column);
    } catch (error) {
      return { ok: false, reason: "validation", message: messageOf(error) };
    }

    try {
      const payload = { data: codec.encode(typed) } as unknown as UpdateValues<Schema.PageColumnValue>;
      const lookup = { id: existing.id } as LookupValues<Schema.PageColumnValue>;

      const updated = await this.db.update(payload, lookup);
      if (!updated) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      const row = await this.db.find(lookup);
      if (!row) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: this.toDecoded(row, column) };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async getValue(pageId: string, columnId: string): Promise<ServiceResult<Schema.DecodedColumnValue>> {
    try {
      const row = await this.findCell(pageId, columnId);
      if (!row) {
        return { ok: false, reason: "not_found", message: `"Page_column_value" não encontrado` };
      }

      const column = await db.pageColumns.find({ id: columnId } as LookupValues<Schema.PageColumn>);
      if (!column || !VALUE_CODECS[column.type]) {
        // FK garante a coluna; ausência aqui é estado inesperado.
        return { ok: false, reason: "server_error", message: "Erro no servidor" };
      }

      return { ok: true, data: this.toDecoded(row, column) };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async deleteValue(pageId: string, columnId: string): Promise<ServiceResult<null>> {
    try {
      const row = await this.findCell(pageId, columnId);
      if (!row) {
        return { ok: false, reason: "not_found", message: `"Page_column_value" não encontrado` };
      }

      const deleted = await this.db.delete({ id: row.id } as LookupValues<Schema.PageColumnValue>);
      if (!deleted) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: null };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  // A célula é o par (page_id, page_column_id) -- único no banco.
  private async findCell(pageId: string | null | undefined, columnId: string | null | undefined) {
    if (!pageId || !columnId) return null;
    return this.db.find(
      { page_id: pageId, page_column_id: columnId } as LookupValues<Schema.PageColumnValue>,
    );
  }

  // Resolve o valor "nu" do payload dinâmico: coluna `date` aceita
  // { startDate, endDate } (vira "start@end"), só startDate (data única) ou { value };
  // os demais tipos usam sempre `value`.
  private resolveRawValue(
    column: Schema.PageColumn,
    input: { value?: unknown; startDate?: string; endDate?: string },
  ): unknown {
    if (column.type !== "date") return input.value;

    const { startDate, endDate, value } = input;
    if (startDate !== undefined && endDate !== undefined) return `${startDate}@${endDate}`;
    if (startDate !== undefined) return startDate;
    if (endDate !== undefined) return endDate;
    return value;
  }

  // Monta a resposta decodificada (sem envelope) a partir do row + a coluna dona.
  private toDecoded(row: Schema.PageColumnValue, column: Schema.PageColumn): Schema.DecodedColumnValue {
    const codec = VALUE_CODECS[column.type];
    return {
      id: row.id,
      page_id: row.page_id,
      page_column_id: row.page_column_id,
      type: column.type,
      // `data` não passa por jsonColumns: chega como string crua -> codec decodifica.
      value: codec.decode(row.data as unknown as string),
    };
  }

}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageColumnValueController();
