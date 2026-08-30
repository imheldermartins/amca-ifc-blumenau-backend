import { ulid } from "ulid";
import db from "@models/index";
import type { Model } from "@/core/db/model";
import { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { VALUE_CODECS } from "@/services/value-codec";

const COLUMN_TYPES: readonly Schema.ColumnType[] = ["text", "numeric", "select", "date", "checkbox"];
const COLOR_OPTIONS: readonly Schema.ColorOptions[] = Schema.COLOR_OPTIONS;
const NUMBER_FORMATS: readonly Schema.NumberFormat[] = ["percentage", "currency"];
const CURRENCY_CODES: readonly Schema.CurrencyCode[] = ["BRL"];
const TEXT_MASKS: readonly Schema.TextMask[] = ["cpf", "cep", "phone-br", "date"];
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

const isColumnType = (value: unknown): value is Schema.ColumnType =>
  typeof value === "string" && (COLUMN_TYPES as readonly string[]).includes(value);
const isColorOption = (value: unknown): value is Schema.ColorOptions =>
  typeof value === "string" && (COLOR_OPTIONS as readonly string[]).includes(value);
const isNumberFormat = (value: unknown): value is Schema.NumberFormat =>
  typeof value === "string" && (NUMBER_FORMATS as readonly string[]).includes(value);
const isCurrencyCode = (value: unknown): value is Schema.CurrencyCode =>
  typeof value === "string" && (CURRENCY_CODES as readonly string[]).includes(value);
const isTextMask = (value: unknown): value is Schema.TextMask =>
  typeof value === "string" && (TEXT_MASKS as readonly string[]).includes(value);

/**
 * Config BASE de um tipo — o `data` "limpo", sem herança de outros tipos. É o
 * destino do "reset de tipos" (rota /reset) e o ponto de partida do create.
 * `select` nasce com `options: []`; os demais com `{}`.
 */
const baseData = (type: Schema.ColumnType): Schema.PageColumnData =>
  type === "select" ? { options: [] } : {};

/**
 * Valor de célula PADRÃO por tipo, aplicado pelo /reset às células divergentes.
 * `clear` = apagar o valor (célula fica vazia); os demais gravam o default.
 */
const CELL_RESET: Record<Schema.ColumnType, { clear: true } | { clear: false; value: unknown }> = {
  text: { clear: false, value: "" },
  numeric: { clear: false, value: 0 },
  checkbox: { clear: false, value: false },
  select: { clear: true },
  date: { clear: true },
};

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
      // Parte da base do tipo e mescla o que vier no payload (whitelist).
      data = this.mergeData(baseData(type), input);
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

    // O `data` é PARCIAL e ACUMULA: mescla o que vier com o `existing.data`, sem
    // apagar o config de outro tipo (a preservação da troca de tipo) e sem
    // deixar passar chave desconhecida (whitelist). Trocar SÓ o `type` não mexe
    // no data — o config antigo fica preservado para um eventual retrocesso.
    const hasConfig =
      input.options !== undefined ||
      input.format !== undefined ||
      input.currency !== undefined ||
      input.mask !== undefined;
    if (hasConfig) {
      try {
        payload.data = this.mergeData(existing.data, input);
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
   * Mescla o `data` existente com o payload, chave a chave, VALIDANDO cada uma
   * pelo seu domínio e IGNORANDO qualquer chave desconhecida (whitelist nas
   * DUAS pontas: parte só das chaves conhecidas do existente, então lixo de um
   * write antigo não sobrevive). Lança (pt-BR) em valor inválido de chave
   * conhecida.
   *
   * NÃO filtra por tipo de propósito: o `data` ACUMULA config de vários tipos
   * (a preservação da troca de tipo). A limpeza vem só pelo `resetColumn`.
   */
  private mergeData(
    existing: Schema.PageColumnData | undefined,
    input: { options?: unknown; format?: unknown; currency?: unknown; mask?: unknown },
  ): Schema.PageColumnData {
    const data: Schema.PageColumnData = {};

    // 1) preserva só o que o existente tem de VÁLIDO.
    if (Array.isArray(existing?.options)) data.options = existing.options;
    if (isNumberFormat(existing?.format)) data.format = existing.format;
    if (isCurrencyCode(existing?.currency)) data.currency = existing.currency;
    if (isTextMask(existing?.mask)) data.mask = existing.mask;

    // 2) aplica o payload, chave a chave. Convenção:
    //    - undefined = não veio → PRESERVA o que estava;
    //    - null      = LIMPA aquela config (ex.: "nenhuma máscara");
    //    - valor     = valida e grava.
    if (input.options === null) delete data.options;
    else if (input.options !== undefined) {
      if (!Array.isArray(input.options)) {
        throw new Error(`Configuração de opções inválida para a coluna "select"`);
      }
      data.options = input.options.map((option) => this.normalizeOption(option));
    }

    if (input.format === null) delete data.format;
    else if (input.format !== undefined) {
      if (!isNumberFormat(input.format)) throw new Error("Formato numérico inválido");
      data.format = input.format;
    }

    if (input.currency === null) delete data.currency;
    else if (input.currency !== undefined) {
      if (!isCurrencyCode(input.currency)) throw new Error("Moeda inválida");
      data.currency = input.currency;
    }

    if (input.mask === null) delete data.mask;
    else if (input.mask !== undefined) {
      if (!isTextMask(input.mask)) throw new Error("Máscara inválida");
      data.mask = input.mask;
    }

    return data;
  }

  /**
   * "Reset de tipos" — a limpeza DESTRUTIVA que resolve a divergência. Grava o
   * `data` na BASE do tipo atual (descarta o config preservado dos outros
   * tipos) e sobrescreve as células cujo valor não valida mais sob a base
   * (`CELL_RESET`: apaga ou grava o default do tipo). Devolve a coluna já em
   * base e cada célula com o valor efetivamente persistido, para o realtime
   * não transformar defaults falsy (`""`, `0`, `false`) em ausência (`null`).
   */
  async resetColumn(
    lookup: LookupValues<Schema.PageColumn>,
  ): Promise<ServiceResult<{
    column: Schema.PageColumn;
    resetCells: Array<{ rowId: string; value: unknown }>;
  }>> {
    const existing = await this.db.find(lookup);
    if (!existing) {
      return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
    }
    if (!isColumnType(existing.type)) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    try {
      const base = baseData(existing.type);
      await this.db.update(
        { data: base } as UpdateValues<Schema.PageColumn>,
        lookup,
      );

      const column = await this.db.find(lookup);
      if (!column) return { ok: false, reason: "server_error", message: "Erro no servidor" };

      const resetCells = await this.resetDivergingValues(column);
      return { ok: true, data: { column, resetCells } };
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  /**
   * Percorre os valores da coluna e, para cada célula cujo valor NÃO valida sob
   * a coluna (já em base), aplica o `CELL_RESET` do tipo (apaga ou grava o
   * default). Devolve os `page_id` tocados. A divergência é medida contra a
   * BASE — para select isso zera todas as células (base sem options), o
   * "reset total" pretendido.
   */
  private async resetDivergingValues(
    column: Schema.PageColumn,
  ): Promise<Array<{ rowId: string; value: unknown }>> {
    const codec = VALUE_CODECS[column.type];
    if (!codec) return [];

    const values = (await db.pageColumnValues.findAll({
      page_column_id: column.id,
    } as unknown as LookupsConfig<Schema.PageColumnValue>)) ?? [];

    const reset = CELL_RESET[column.type];
    const touched: Array<{ rowId: string; value: unknown }> = [];

    for (const row of values) {
      if (!row.page_id) continue;

      let valid = true;
      try {
        codec.validate(codec.decode(row.data as unknown as string), column);
      } catch {
        valid = false;
      }
      if (valid) continue;

      if (reset.clear) {
        await db.pageColumnValues.delete({ id: row.id } as LookupValues<Schema.PageColumnValue>);
      } else {
        await db.pageColumnValues.update(
          { data: codec.encode(reset.value) } as unknown as UpdateValues<Schema.PageColumnValue>,
          { id: row.id } as LookupValues<Schema.PageColumnValue>,
        );
      }
      touched.push({
        rowId: row.page_id,
        value: reset.clear ? null : reset.value,
      });
    }

    return touched;
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
