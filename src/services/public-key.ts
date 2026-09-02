import type { Schema } from "@/models/schemas/index";

const PUBLIC_KEY_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type PublicKeyFallback = "coluna" | "opcao" | "view";

export interface PublicKeyEntity {
  id: string;
  label: string | null | undefined;
  publicKey?: Schema.PublicKeyMetadata | null | undefined;
}

/**
 * Converte um label em uma key estavel e legivel para URL. A identidade de
 * dominio continua sendo o ULID; esta funcao nunca tenta fabricar ids.
 */
export function normalizePublicKey(
  label: string | null | undefined,
  fallback: PublicKeyFallback,
): string {
  const normalized = (label ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

export function isPublicKey(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_KEY_RE.test(value);
}

function sanitizeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isPublicKey))];
}

export function sanitizePublicKeyMetadata(
  value: unknown,
): Schema.PublicKeyMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { key?: unknown; aliases?: unknown };
  if (!isPublicKey(candidate.key)) return null;
  return {
    key: candidate.key,
    aliases: sanitizeAliases(candidate.aliases).filter((alias) => alias !== candidate.key),
  };
}

/** Menor sufixo livre: `status`, `status_2`, `status_3`, ... */
export function allocatePublicKey(base: string, reserved: ReadonlySet<string>): string {
  if (!reserved.has(base)) return base;

  let suffix = 2;
  while (reserved.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/**
 * Atualiza uma metadata ao renomear. A key anterior vira alias e fica
 * reservada; se o label nao mudou (inclusive um sufixo de colisao), a key
 * atual permanece estavel.
 */
export function reconcilePublicKeyMetadata(
  label: string | null | undefined,
  fallback: PublicKeyFallback,
  current: unknown,
  reservedByOthers: ReadonlySet<string> = new Set(),
  options: { forceRename?: boolean } = {},
): Schema.PublicKeyMetadata {
  const base = normalizePublicKey(label, fallback);
  const existing = sanitizePublicKeyMetadata(current);

  if (existing && !options.forceRename && !reservedByOthers.has(existing.key)) {
    // Reconcile não adivinha rename a partir do label: metadata válida é
    // estável. Renames explícitos chegam com `forceRename`; aqui apenas
    // removemos aliases que colidam com outra entidade do mesmo escopo.
    return {
      key: existing.key,
      aliases: existing.aliases.filter((alias) => !reservedByOthers.has(alias)),
    };
  }

  // Metadata legada pode conter uma colisao que nunca deveria ter existido.
  // Nesse reparo, a segunda entidade NAO herda a key/alias ja pertencente a
  // outra: isso recriaria a ambiguidade que o reconcile pretende remover.
  const aliases = existing
    ? [...new Set([...existing.aliases, existing.key])].filter(
        (candidate) => candidate !== base && !reservedByOthers.has(candidate),
      )
    : [];
  const reserved = new Set([...reservedByOthers, ...aliases]);
  const key = allocatePublicKey(base, reserved);

  return {
    key,
    aliases: aliases.filter((alias) => alias !== key),
  };
}

/**
 * Reconcilia um escopo inteiro de forma deterministica. Keys e aliases
 * existentes sao pre-reservados antes de preencher lacunas, evitando que um
 * item legado roube a URL de outro item que ja tinha metadata valida.
 */
export function reconcilePublicKeyScope(
  entities: readonly PublicKeyEntity[],
  fallback: PublicKeyFallback,
  externallyReserved: ReadonlySet<string> = new Set(),
): Map<string, Schema.PublicKeyMetadata> {
  const owners = new Map<string, string>();

  for (const candidate of externallyReserved) owners.set(candidate, "__reserved__");

  for (const entity of entities) {
    const metadata = sanitizePublicKeyMetadata(entity.publicKey);
    if (!metadata) continue;
    for (const candidate of [metadata.key, ...metadata.aliases]) {
      if (!owners.has(candidate)) owners.set(candidate, entity.id);
    }
  }

  // Um item legado sem metadata ainda reserva sua base. Assim, ao criar um
  // homonimo, o item novo recebe `_2`, mesmo antes do reconcile global.
  for (const entity of entities) {
    if (sanitizePublicKeyMetadata(entity.publicKey)) continue;
    const base = normalizePublicKey(entity.label, fallback);
    if (!owners.has(base)) owners.set(base, entity.id);
  }

  const result = new Map<string, Schema.PublicKeyMetadata>();
  const committed = new Map<string, string>();

  for (const entity of entities) {
    const reservedByOthers = new Set<string>();
    for (const [candidate, ownerId] of owners) {
      if (ownerId !== entity.id) reservedByOthers.add(candidate);
    }
    for (const [candidate, ownerId] of committed) {
      if (ownerId !== entity.id) reservedByOthers.add(candidate);
    }

    const metadata = reconcilePublicKeyMetadata(
      entity.label,
      fallback,
      entity.publicKey,
      reservedByOthers,
    );
    result.set(entity.id, metadata);
    committed.set(metadata.key, entity.id);
    for (const alias of metadata.aliases) committed.set(alias, entity.id);
  }

  return result;
}

/**
 * Sufixo visual para entidades NOVAS. Reconcile de legado nao chama esta
 * funcao, portanto labels repetidos antigos permanecem intactos.
 */
export function allocateDuplicateLabel(
  requested: string,
  existingLabels: readonly (string | null | undefined)[],
): string {
  const trimmed = requested.trim();
  if (!trimmed) return requested;

  const taken = new Set(
    existingLabels
      .filter((label): label is string => typeof label === "string")
      .map((label) => label.trim().toLocaleLowerCase("pt-BR")),
  );
  if (!taken.has(trimmed.toLocaleLowerCase("pt-BR"))) return requested;

  let suffix = 2;
  while (taken.has(`${trimmed} (${suffix})`.toLocaleLowerCase("pt-BR"))) suffix += 1;
  return `${trimmed} (${suffix})`;
}

/** Reserva metadata e, para legado, a key que ele recebera no reconcile. */
export function collectReservedPublicKeys(
  entities: readonly PublicKeyEntity[],
  fallback: PublicKeyFallback,
): Set<string> {
  const reserved = new Set<string>();
  for (const entity of entities) {
    const metadata = sanitizePublicKeyMetadata(entity.publicKey);
    if (metadata) {
      reserved.add(metadata.key);
      metadata.aliases.forEach((alias) => reserved.add(alias));
    } else {
      reserved.add(normalizePublicKey(entity.label, fallback));
    }
  }
  return reserved;
}
