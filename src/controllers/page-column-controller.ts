import { ulid } from "ulid";
import db from "@models/index";
import type { Model } from "@/core/db/model";
import { Schema } from "@/models/schemas/index";
import type { Input } from "@/models/schemas/inputs";
import { VALUE_CODECS } from "@/services/value-codec";
import { updatePageJsonPaths } from "@/core/db/page-json";
import {
  FILTER_KEY_REGISTRY_DATA_KEY,
  appendDeletedColumnKeys,
  collectPageColumnReservations,
  optionTombstones,
  sanitizeReservedOptionKeys,
} from "@/services/filter-key-registry";
import {
  allocateDuplicateLabel,
  collectReservedPublicKeys,
  normalizePublicKey,
  reconcilePublicKeyMetadata,
  sanitizePublicKeyMetadata,
} from "@/services/public-key";

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
    const result = await this.deleteColumn(lookup);
    return result.ok;
  }

  // --- Variantes com validação (usadas pela rota; retornam ServiceResult) ---

  async createColumn(input: Input.CreatePageColumn): Promise<ServiceResult<Schema.PageColumn>> {
    const type = input?.type;
    if (!isColumnType(type)) {
      return { ok: false, reason: "validation", message: "Tipo de coluna não suportado" };
    }

    let data: Schema.PageColumnData;
    let name = input.name ?? null;
    let siblings: Schema.PageColumn[] = [];
    let parent: Schema.Page | null = null;
    try {
      if (input.parent_id) {
        [siblings, parent] = await Promise.all([
          this.db
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
        name = allocateDuplicateLabel(name, siblings.map((column) => column.name));
      }

      // Parte da base do tipo e mescla o que vier no payload (whitelist).
      data = this.mergeData(baseData(type), input);
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
      const created = await this.db.create({
        name,
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
    let existing: Schema.PageColumn | null;
    try {
      existing = await this.db.find(lookup);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
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
    let siblings: Schema.PageColumn[] = [];
    let parent: Schema.Page | null = null;
    try {
      if (existing.parent_id) {
        [siblings, parent] = await Promise.all([
          this.db
            .findAll({ parent_id: existing.parent_id } as LookupsConfig<Schema.PageColumn>)
            .then((columns) => columns ?? []),
          db.pages.find({ id: existing.parent_id } as LookupValues<Schema.Page>),
        ]);
      }
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }

    try {
      const nextData = hasConfig
        ? this.mergeData(existing.data, input)
        : this.mergeData(existing.data, {});
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

  /** Exclui uma coluna sem permitir que sua URL pública seja reutilizada. */
  async deleteColumn(
    lookup: LookupValues<Schema.PageColumn>,
  ): Promise<ServiceResult<Schema.PageColumn>> {
    try {
      const existing = await this.db.find(lookup);
      if (!existing) {
        return { ok: false, reason: "not_found", message: `"Page_column" não encontrado` };
      }

      // O tombstone é gravado antes da exclusão. Se o DELETE falhar, sobra uma
      // reserva conservadora; o cenário perigoso (link antigo mudar de alvo)
      // nunca ocorre.
      if (existing.parent_id) {
        const page = await db.pages.find({ id: existing.parent_id } as LookupValues<Schema.Page>);
        if (!page) return { ok: false, reason: "not_found", message: "Página não encontrada" };
        const tombstones = appendDeletedColumnKeys(page.data, existing);
        const reserved = await updatePageJsonPaths(existing.parent_id, [
          {
            path: [FILTER_KEY_REGISTRY_DATA_KEY, "columns"],
            value: tombstones,
          },
        ]);
        if (!reserved) {
          return { ok: false, reason: "server_error", message: "Erro no servidor" };
        }
      }

      const deleted = await this.db.delete(lookup);
      if (!deleted) return { ok: false, reason: "server_error", message: "Erro no servidor" };
      return { ok: true, data: existing };
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
    const publicKey = sanitizePublicKeyMetadata(existing?.publicKey);
    if (publicKey) data.publicKey = publicKey;
    const existingOptionTombstones = sanitizeReservedOptionKeys(existing?.reservedOptionKeys);
    if (existingOptionTombstones.length > 0) {
      data.reservedOptionKeys = existingOptionTombstones;
    }

    // 2) aplica o payload, chave a chave. Convenção:
    //    - undefined = não veio → PRESERVA o que estava;
    //    - null      = LIMPA aquela config (ex.: "nenhuma máscara");
    //    - valor     = valida e grava.
    if (input.options === null) {
      const tombstones = optionTombstones(
        existing?.options ?? [],
        new Set(),
        data.reservedOptionKeys,
      );
      delete data.options;
      if (tombstones.length > 0) data.reservedOptionKeys = tombstones;
    } else if (input.options !== undefined) {
      if (!Array.isArray(input.options)) {
        throw new Error(`Configuração de opções inválida para a coluna "select"`);
      }
      const retainedIds = new Set(
        input.options.flatMap((option) => {
          if (!option || typeof option !== "object") return [];
          const id = (option as { id?: unknown }).id;
          return typeof id === "string" ? [id] : [];
        }),
      );
      const tombstones = optionTombstones(
        existing?.options ?? [],
        retainedIds,
        data.reservedOptionKeys,
      );
      data.options = this.normalizeOptions(
        input.options,
        existing?.options ?? [],
        new Set(tombstones),
      );
      if (tombstones.length > 0) data.reservedOptionKeys = tombstones;
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
      const publicKey = sanitizePublicKeyMetadata(existing.data?.publicKey);
      if (publicKey) base.publicKey = publicKey;
      else base.publicKey = reconcilePublicKeyMetadata(existing.name, "coluna", null);
      const removedOptionKeys = optionTombstones(
        existing.data?.options ?? [],
        new Set(),
        existing.data?.reservedOptionKeys,
      );
      if (removedOptionKeys.length > 0) base.reservedOptionKeys = removedOptionKeys;
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

  private normalizeOptions(
    options: readonly unknown[],
    existingOptions: readonly Schema.SelectOption[],
    externallyReserved: ReadonlySet<string> = new Set(),
  ): Schema.SelectOption[] {
    const existingById = new Map(existingOptions.map((option) => [option.id, option]));
    const prepared = options.map((option) => {
      if (!option || typeof option !== "object") {
        throw new Error(`Configuração de opções inválida para a coluna "select"`);
      }
      const { id, value, color } = option as Partial<Schema.SelectOption>;
      if (typeof value !== "string") {
        throw new Error(`Configuração de opções inválida para a coluna "select"`);
      }

      let optionId: Schema.SelectOption["id"];
      if (id === undefined || id === null) optionId = ulid() as Schema.SelectOption["id"];
      else if (typeof id === "string" && ULID_RE.test(id)) optionId = id as Schema.SelectOption["id"];
      else throw new Error(`Configuração de opções inválida para a coluna "select"`);

      if (color !== undefined && !isColorOption(color)) {
        throw new Error(`Configuração de opções inválida para a coluna "select"`);
      }
      return {
        id: optionId,
        value,
        ...(color !== undefined && { color }),
        existing: existingById.get(optionId),
      };
    });

    // Sufixo visual somente para options novas. Labels legados/renames ficam
    // intactos e apenas suas public keys sao diferenciadas.
    const labels = prepared
      .filter((option) => option.existing)
      .map((option) => option.value);
    for (const option of prepared) {
      if (!option.existing) option.value = allocateDuplicateLabel(option.value, labels);
      labels.push(option.value);
    }

    const normalized: Schema.SelectOption[] = [];
    for (const option of prepared) {
      const others = [
        ...normalized.map((candidate) => ({
          id: candidate.id,
          label: candidate.value,
          publicKey: candidate.publicKey,
        })),
        ...prepared
          .filter((candidate) => candidate.id !== option.id && !normalized.some((item) => item.id === candidate.id))
          .map((candidate) => ({
            id: candidate.id,
            label: candidate.value,
            publicKey: candidate.existing?.publicKey,
          })),
      ];
      const metadata = reconcilePublicKeyMetadata(
        option.value,
        "opcao",
        option.existing?.publicKey,
        new Set([...collectReservedPublicKeys(others, "opcao"), ...externallyReserved]),
        {
          forceRename:
            !!option.existing &&
            normalizePublicKey(option.existing.value, "opcao") !==
              normalizePublicKey(option.value, "opcao"),
        },
      );
      normalized.push({
        id: option.id,
        value: option.value,
        ...(option.color !== undefined && { color: option.color }),
        publicKey: metadata,
      });
    }

    return normalized;
  }
}

// Singleton: as rotas importam direto, sem conhecer req/res.
export default new PageColumnController();
