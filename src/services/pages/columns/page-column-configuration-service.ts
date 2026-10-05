import type { Schema } from "@/db/schemas/index";
import {
  optionTombstones,
  sanitizeReservedOptionKeys,
} from "@/services/filter-key-registry";
import { sanitizePublicKeyMetadata } from "@/services/public-key";
import pageSelectOptionService, {
  type PageSelectOptionService,
} from "@/services/pages/columns/page-select-option-service";
import type { PageColumnConfigurationInput } from "@/services/pages/columns/types/page-column-configuration.types";

const COLUMN_TYPES = new Set<Schema.ColumnType>([
  "text",
  "numeric",
  "select",
  "date",
  "checkbox",
  "flow",
]);
const NUMBER_FORMATS = new Set<Schema.NumberFormat>(["percentage", "currency"]);
const CURRENCY_CODES = new Set<Schema.CurrencyCode>(["BRL"]);
const TEXT_MASKS = new Set<Schema.TextMask>(["cpf", "cep", "phone-br", "date", "email"]);

export class PageColumnConfigurationService {
  public constructor(
    private readonly selectOptions: PageSelectOptionService = pageSelectOptionService,
  ) {}

  public isColumnType(value: unknown): value is Schema.ColumnType {
    return typeof value === "string" && COLUMN_TYPES.has(value as Schema.ColumnType);
  }

  public base(type: Schema.ColumnType): Schema.PageColumnData {
    return type === "select" ? { options: [] } : {};
  }

  public merge(
    existing: Schema.PageColumnData | undefined,
    input: PageColumnConfigurationInput,
  ): Schema.PageColumnData {
    const data: Schema.PageColumnData = {};

    if (Array.isArray(existing?.options)) data.options = existing.options;
    if (this.isNumberFormat(existing?.format)) data.format = existing.format;
    if (this.isCurrencyCode(existing?.currency)) data.currency = existing.currency;
    if (this.isTextMask(existing?.mask)) data.mask = existing.mask;
    const publicKey = sanitizePublicKeyMetadata(existing?.publicKey);
    if (publicKey) data.publicKey = publicKey;
    const existingOptionTombstones = sanitizeReservedOptionKeys(existing?.reservedOptionKeys);
    if (existingOptionTombstones.length > 0) {
      data.reservedOptionKeys = existingOptionTombstones;
    }
    if (existing?.flow) data.flow = existing.flow;
    if (existing?.flowButton) data.flowButton = existing.flowButton;
    if (input.flowButton !== undefined) {
      const button = input.flowButton as Record<string, unknown> | null;
      if (!button || typeof button !== 'object' || Array.isArray(button)
        || (button.label !== null && (typeof button.label !== 'string' || button.label.length > 80))
        || typeof button.icon !== 'string' || !/^[a-z0-9-]+:[a-z0-9-]+$/.test(button.icon) || button.icon.length > 120) {
        throw new Error('Botão Flow inválido');
      }
      data.flowButton = { label: typeof button.label === 'string' ? button.label.trim() || null : null, icon: button.icon };
    }

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
        throw new Error('Configuração de opções inválida para a coluna "select"');
      }
      const retainedIds = new Set(
        input.options.flatMap((option) => {
          if (!option || typeof option !== "object" || Array.isArray(option)) return [];
          const id = (option as Record<string, unknown>).id;
          return typeof id === "string" ? [id] : [];
        }),
      );
      const tombstones = optionTombstones(
        existing?.options ?? [],
        retainedIds,
        data.reservedOptionKeys,
      );
      data.options = this.selectOptions.normalize(
        input.options,
        existing?.options ?? [],
        new Set(tombstones),
      );
      if (tombstones.length > 0) data.reservedOptionKeys = tombstones;
    }

    if (input.format === null) delete data.format;
    else if (input.format !== undefined) {
      if (!this.isNumberFormat(input.format)) throw new Error("Formato numérico inválido");
      data.format = input.format;
    }

    if (input.currency === null) delete data.currency;
    else if (input.currency !== undefined) {
      if (!this.isCurrencyCode(input.currency)) throw new Error("Moeda inválida");
      data.currency = input.currency;
    }

    if (input.mask === null) delete data.mask;
    else if (input.mask !== undefined) {
      if (!this.isTextMask(input.mask)) throw new Error("Máscara inválida");
      data.mask = input.mask;
    }

    return data;
  }

  private isNumberFormat(value: unknown): value is Schema.NumberFormat {
    return typeof value === "string" && NUMBER_FORMATS.has(value as Schema.NumberFormat);
  }

  private isCurrencyCode(value: unknown): value is Schema.CurrencyCode {
    return typeof value === "string" && CURRENCY_CODES.has(value as Schema.CurrencyCode);
  }

  private isTextMask(value: unknown): value is Schema.TextMask {
    return typeof value === "string" && TEXT_MASKS.has(value as Schema.TextMask);
  }
}

export default new PageColumnConfigurationService();
