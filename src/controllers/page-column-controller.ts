import { ulid } from "ulid";
import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";

const COLUMN_TYPES: readonly Schema.ColumnType[] = ["text", "numeric", "select", "date", "checkbox"];
const COLOR_OPTIONS: readonly Schema.ColorOptions[] = ["red", "orange", "yellow", "green", "blue", "grey"];
const NUMBER_FORMATS: readonly Schema.NumberFormat[] = ["percentage", "currency"];
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

const isColumnType = (value: unknown): value is Schema.ColumnType =>
  typeof value === "string" && (COLUMN_TYPES as readonly string[]).includes(value);
const isColorOption = (value: unknown): value is Schema.ColorOptions =>
  typeof value === "string" && (COLOR_OPTIONS as readonly string[]).includes(value);
const isNumberFormat = (value: unknown): value is Schema.NumberFormat =>
  typeof value === "string" && (NUMBER_FORMATS as readonly string[]).includes(value);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Erro no servidor";

/**
 * page_columns: CRUD base + validação de domínio (este controller é a camada de
 * service no padrão do repo). `type` precisa estar em ColumnType; para `select`,
 * `data.options` precisa ser array de { id(ULID)/value(string)/color(ColorOptions) }.
 *
 * Falhas distinguíveis (validação 400 / não encontrado 404) saem como ServiceResult
 * em createColumn/updateColumn -- a rota mapeia reason -> StatusCode. Os métodos do
 * IBaseController delegam a essas variantes (fonte única da regra).
 */
class PageColumnController implements IBaseController<Schema.PageColumn> {
  private db: Model<Schema.PageColumn> = db.pageColumns;

  async all(lookup?: LookupsConfig<Schema.PageColumn>) {
    try {
      const columns = await this.db.findAll(lookup);

      if (!columns) throw new Error("No page columns found");

      return columns;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async get(lookup: LookupValues<Schema.PageColumn>) {
    try {
      const column = await this.db.find(lookup);

      if (!column) throw new Error("Page column not found");

      return column;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  // IBaseController: delega para a variante validada (fonte única da regra).
  async create(data: CreateValues<Schema.PageColumn>) {
    const result = await this.createColumn(data as unknown as Input.CreatePageColumn);
    return result.ok ? result.data : null;
  }

  async update(lookup: LookupValues<Schema.PageColumn>, data: UpdateValues<Schema.PageColumn>) {
    const result = await this.updateColumn(lookup, data as unknown as Input.UpdatePageColumn);
    return result.ok ? result.data : null;
  }

  async delete(lookup: LookupValues<Schema.PageColumn>) {
    try {
      const deleted = await this.db.delete(lookup);

      if (!deleted) throw new Error("Failed to delete page column");

      return deleted;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return false;
    }
  }

  // --- Variantes com validação (usadas pela rota; retornam ServiceResult) ---

  async createColumn(input: Input.CreatePageColumn): Promise<ServiceResult<Schema.PageColumn>> {
    const type = input?.type;
    if (!isColumnType(type)) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    let data: Schema.PageColumnData;
    try {
      data = this.buildData(type, input);
    } catch (error) {
      return { ok: false, reason: "validation", message: messageOf(error) };
    }

    try {
      const created = await this.db.create({
        name: input.name ?? null,
        type,
        data,
        parent_id: input.parent_id ?? null,
      } as unknown as CreateValues<Schema.PageColumn>);

      if (!created) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: created };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  // `lookup` permite escopar a coluna (ex.: { id, parent_id }) -- assim a rota
  // aninhada não altera coluna de outra página parent.
  async updateColumn(
    lookup: LookupValues<Schema.PageColumn>,
    input: Input.UpdatePageColumn,
  ): Promise<ServiceResult<Schema.PageColumn>> {
    const existing = await this.db.find(lookup);
    if (!existing) {
      return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
    }

    const effectiveType = input.type ?? existing.type;
    if (!isColumnType(effectiveType)) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    const payload: UpdateValues<Schema.PageColumn> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.type !== undefined) payload.type = input.type;
    if (input.options !== undefined || input.format !== undefined) {
      try {
        payload.data = this.buildData(effectiveType, input);
      } catch (error) {
        return { ok: false, reason: "validation", message: messageOf(error) };
      }
    }

    // Nada para atualizar: no-op, devolve o registro atual.
    if (Object.keys(payload).length === 0) return { ok: true, data: existing };

    try {
      const updated = await this.db.update(payload, lookup);
      if (!updated) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      const column = await this.db.find(lookup);
      if (!column) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      return { ok: true, data: column };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  /**
   * Monta o `data` da coluna a partir do payload dinâmico por tipo:
   *  - `select`  -> exige `options` (array de { value, color? }); normaliza cada uma
   *    (gera o ULID do id; color é opcional).
   *  - `numeric` -> `format?` ('percentage' | 'currency'), só armazenado.
   *  - demais    -> `{}` (sem config).
   * Lança (mensagem pt-BR) em configuração inválida.
   */
  private buildData(
    type: Schema.ColumnType,
    input: { options?: unknown; format?: unknown },
  ): Schema.PageColumnData {
    if (type === "select") {
      const options = input.options;
      if (!Array.isArray(options)) {
        throw new Error(`Configuração de opções inválida para a coluna "select"`);
      }
      return { options: options.map((option) => this.normalizeOption(option)) };
    }

    if (type === "numeric") {
      if (input.format === undefined) return {};
      if (!isNumberFormat(input.format)) {
        throw new Error("Formato numérico inválido");
      }
      return { format: input.format };
    }

    return {};
  }

  private normalizeOption(option: unknown): Schema.SelectOption {
    if (!option || typeof option !== "object") {
      throw new Error(`Configuração de opções inválida para a coluna "select"`);
    }

    const { id, value, color } = option as Partial<Schema.SelectOption>;

    if (typeof value !== "string") {
      throw new Error(`Configuração de opções inválida para a coluna "select"`);
    }

    // id: o payload normalmente não traz -> gera no backend; aceita se vier ULID válido.
    let optionId: string;
    if (id === undefined || id === null) {
      optionId = ulid();
    } else if (typeof id === "string" && ULID_RE.test(id)) {
      optionId = id;
    } else {
      throw new Error(`Configuração de opções inválida para a coluna "select"`);
    }

    // color é opcional: se não vier, a option fica sem cor (sem default).
    if (color === undefined) {
      return { id: optionId as Schema.SelectOption["id"], value };
    }
    if (!isColorOption(color)) {
      throw new Error(`Configuração de opções inválida para a coluna "select"`);
    }
    return { id: optionId as Schema.SelectOption["id"], value, color };
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageColumnController();
