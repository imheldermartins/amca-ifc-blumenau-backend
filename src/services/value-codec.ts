import { type Schema } from "@models/schemas/index";

/**
 * Codec central dos valores de célula (page_columns_values.data).
 *
 * O cliente da API trabalha SEMPRE com o valor "nu" (string/number/boolean/...).
 * O banco guarda SEMPRE o envelope `{"value":<T>}` como string JSON. Este módulo
 * é a única fronteira dessa tradução -- por isso o model de page_columns_values
 * NÃO registra `data` em jsonColumns: quem (de)serializa o envelope é o codec.
 *
 * É lógica de domínio (não vai em utils/): `validate` aplica a regra de cada tipo
 * e LANÇA (mensagem pt-BR) em entrada inválida; o controller traduz o throw num
 * resultado de falha (400) para a rota.
 */

// ULID: 26 chars em Crockford base32.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

// ISO 8601 estrito no formato documentado: yyyy-mm-ddTHH:mm:ss.sssZ.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isValidIso(value: string): boolean {
  return ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Lê as `options` de uma coluna `select`. Tolerante à origem do `data`: objeto
 * (já desserializado pelo Model) ou string JSON crua.
 */
function readOptions(column: Schema.PageColumn): Schema.SelectOption[] {
  const raw = column?.data as unknown;

  let parsed: Schema.PageColumnData | null = null;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as Schema.PageColumnData;
    } catch {
      parsed = null;
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw as Schema.PageColumnData;
  }

  return Array.isArray(parsed?.options) ? (parsed!.options as Schema.SelectOption[]) : [];
}

// encode é igual para todos: serializa o envelope. O que varia é o validate.
function encodeEnvelope(value: unknown): string {
  return JSON.stringify({ value } satisfies Schema.ColumnValueEnvelope);
}

/**
 * decode centraliza a leitura: nunca devolve a string crua. Recebe a string
 * gravada (`data` não passa por jsonColumns), mas tolera um envelope já em
 * objeto, caso a origem mude.
 */
function decodeEnvelope(data: string): unknown {
  if (typeof data !== "string") {
    return (data as unknown as Schema.ColumnValueEnvelope)?.value;
  }
  try {
    return (JSON.parse(data) as Schema.ColumnValueEnvelope)?.value;
  } catch {
    return undefined;
  }
}

const textCodec: Schema.ColumnValueCodec<string> = {
  validate(rawValue) {
    if (typeof rawValue !== "string") throw new Error("Valor de texto inválido");
    return rawValue;
  },
  encode: encodeEnvelope,
  decode: (data) => decodeEnvelope(data) as string,
};

const numericCodec: Schema.ColumnValueCodec<number> = {
  validate(rawValue) {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error("Valor numérico inválido");
    }
    return rawValue;
  },
  encode: encodeEnvelope,
  decode: (data) => decodeEnvelope(data) as number,
};

const checkboxCodec: Schema.ColumnValueCodec<boolean> = {
  validate(rawValue) {
    if (typeof rawValue !== "boolean") throw new Error("Valor booleano inválido");
    return rawValue;
  },
  encode: encodeEnvelope,
  decode: (data) => decodeEnvelope(data) as boolean,
};

const selectCodec: Schema.ColumnValueCodec<string> = {
  // O valor é o ULID de uma option existente em page_columns.data.options.
  validate(rawValue, column) {
    if (typeof rawValue !== "string" || !ULID_RE.test(rawValue)) {
      throw new Error('Opção inválida para a coluna "select"');
    }

    const belongs = readOptions(column).some((option) => option.id === rawValue);
    if (!belongs) throw new Error('Opção inválida para a coluna "select"');

    return rawValue;
  },
  encode: encodeEnvelope,
  decode: (data) => decodeEnvelope(data) as string,
};

const dateCodec: Schema.ColumnValueCodec<string> = {
  // Data única ISO, ou range "<startISO>@<endISO>" (split em '@'). Guarda
  // exatamente como recebido -- sem normalizar fuso.
  validate(rawValue) {
    if (typeof rawValue !== "string") throw new Error("Data em formato ISO inválido");

    const parts = rawValue.includes("@") ? rawValue.split("@") : [rawValue];
    if (parts.length < 1 || parts.length > 2 || parts.some((part) => !isValidIso(part))) {
      throw new Error("Data em formato ISO inválido");
    }

    return rawValue;
  },
  encode: encodeEnvelope,
  decode: (data) => decodeEnvelope(data) as string,
};

export const VALUE_CODECS: Record<Schema.ColumnType, Schema.ColumnValueCodec> = {
  text: textCodec,
  numeric: numericCodec,
  checkbox: checkboxCodec,
  select: selectCodec,
  date: dateCodec,
};
