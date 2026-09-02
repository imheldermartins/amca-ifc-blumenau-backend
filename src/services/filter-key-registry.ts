import type { Schema } from "@/models/schemas/index";
import {
  collectReservedPublicKeys,
  isPublicKey,
  normalizePublicKey,
  sanitizePublicKeyMetadata,
  type PublicKeyEntity,
} from "@/services/public-key";

export const FILTER_KEY_REGISTRY_DATA_KEY = "__filterKeyRegistry";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniquePublicKeys(values: readonly unknown[]): string[] {
  return [...new Set(values.filter(isPublicKey))];
}

/** Tombstones de colunas excluídas, persistidos no JSON livre da página. */
export function readDeletedColumnKeys(data: unknown): Set<string> {
  if (!isRecord(data)) return new Set();
  const registry = data[FILTER_KEY_REGISTRY_DATA_KEY];
  if (!isRecord(registry) || !Array.isArray(registry.columns)) return new Set();
  return new Set(uniquePublicKeys(registry.columns));
}

/** Todas as apresentações da coluna sintética que uma coluna real não pode roubar. */
export function pageTitlePublicKeyEntities(data: unknown): PublicKeyEntity[] {
  if (!isRecord(data)) return [];
  const entities: PublicKeyEntity[] = [];

  for (const [viewId, rawView] of Object.entries(data)) {
    if (!isRecord(rawView) || typeof rawView.view !== "string" || !isRecord(rawView.title)) continue;
    const title = rawView.title;
    if (title.key !== "title") continue;
    const metadata = sanitizePublicKeyMetadata(title.publicKey);
    entities.push({
      id: `title:${viewId}`,
      label: typeof title.column_name === "string" ? title.column_name : "Título",
      ...(metadata && { publicKey: metadata }),
    });
  }

  return entities;
}

export function collectPageColumnReservations(data: unknown): Set<string> {
  return new Set([
    ...readDeletedColumnKeys(data),
    ...collectReservedPublicKeys(pageTitlePublicKeyEntities(data), "coluna"),
  ]);
}

/** Acrescenta key e aliases ao registro; nunca remove tombstones existentes. */
export function appendDeletedColumnKeys(
  data: unknown,
  column: Pick<Schema.PageColumn, "name" | "data">,
): string[] {
  const reserved = readDeletedColumnKeys(data);
  const metadata = sanitizePublicKeyMetadata(column.data?.publicKey);
  if (metadata) {
    reserved.add(metadata.key);
    metadata.aliases.forEach((alias) => reserved.add(alias));
  } else {
    reserved.add(normalizePublicKey(column.name, "coluna"));
  }
  return [...reserved].sort();
}

export function sanitizeReservedOptionKeys(value: unknown): string[] {
  return Array.isArray(value) ? uniquePublicKeys(value) : [];
}

export function optionTombstones(
  existing: readonly Schema.SelectOption[],
  retainedIds: ReadonlySet<string>,
  current: unknown,
): string[] {
  const reserved = new Set(sanitizeReservedOptionKeys(current));
  for (const option of existing) {
    if (retainedIds.has(String(option.id))) continue;
    const metadata = sanitizePublicKeyMetadata(option.publicKey);
    if (metadata) {
      reserved.add(metadata.key);
      metadata.aliases.forEach((alias) => reserved.add(alias));
    } else {
      reserved.add(normalizePublicKey(option.value, "opcao"));
    }
  }
  return [...reserved].sort();
}
