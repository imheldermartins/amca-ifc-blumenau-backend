type RqliteEnv = {
  RQLITE_URL?: string;
  RQLITE_ADVERTISE_IP?: string;
  RQLITE_PORT?: string;
  RQLITE_USERNAME?: string;
  RQLITE_PASSWORD?: string;
};

function normalizeRqliteUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('RQLITE_URL deve ser uma URL HTTP(S) valida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RQLITE_URL deve usar http:// ou https://.');
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('RQLITE_URL nao deve conter credenciais, path, query string ou fragmento.');
  }

  return url.toString().replace(/\/$/, '');
}

export function resolveRqliteUrl(env: RqliteEnv = process.env): string {
  if (env.RQLITE_URL?.trim()) return normalizeRqliteUrl(env.RQLITE_URL.trim());

  const host = env.RQLITE_ADVERTISE_IP?.trim() || 'localhost';
  const port = env.RQLITE_PORT?.trim() || '8000';
  return normalizeRqliteUrl(`http://${host}:${port}`);
}

export function resolveRqliteAuthorization(env: RqliteEnv = process.env): string | undefined {
  const username = env.RQLITE_USERNAME?.trim();
  const password = env.RQLITE_PASSWORD;

  if (!username && !password) return undefined;
  if (!username || !password) {
    throw new Error('RQLITE_USERNAME e RQLITE_PASSWORD devem ser definidos juntos.');
  }

  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/** @deprecated Use RQLITE_URL para nao confundir a API HTTP com o Raft. */
export const RAFT_URL = resolveRqliteUrl();
export const RQLITE_AUTHORIZATION = resolveRqliteAuthorization();
