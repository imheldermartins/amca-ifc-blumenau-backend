import { createHash, randomBytes } from "node:crypto";

export const WORKSPACE_KEY_ALGORITHM = "sha256-v1";
export const WORKSPACE_KEY_PREFIX = "cubs_ws_v1_";
export const WORKSPACE_KEY_TTL_DAYS = 7;

const KEY_PATTERN = /^cubs_ws_v1_[A-Za-z0-9_-]{32}$/;

/**
 * Contrato de auditoria da credencial de workspace.
 *
 * O segredo tem 192 bits, aparece uma única vez no stdout do comando e o banco
 * recebe somente SHA-256. Se o algoritmo mudar, crie uma versão nova em vez de
 * reinterpretar registros existentes: `algorithm_version` é a marca para a
 * futura trilha de auditoria.
 */
export function createWorkspaceKey(): string {
  return `${WORKSPACE_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function isWorkspaceKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export function hashWorkspaceKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function workspaceKeyHint(value: string): string {
  return `${WORKSPACE_KEY_PREFIX}…${value.slice(-6)}`;
}

export function normalizeWorkspaceEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function normalizeWorkspaceName(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("pt-BR");
}

export function workspaceKeyExpiresAt(now = new Date()): string {
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + WORKSPACE_KEY_TTL_DAYS);
  return expiresAt.toISOString();
}
