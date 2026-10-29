import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { Redis, type RedisOptions } from 'ioredis';

/** Optional for a single server; mandatory for the campus deployment profile. */
export function clusterRedisOptions(env: NodeJS.ProcessEnv = process.env): RedisOptions | null {
  if (env.CUBS_CLUSTER_ENABLED !== 'true') return null;
  const entries = env.CLUSTER_REDIS_SENTINELS?.split(',') ?? [];
  if (entries.length !== 3 || new Set(entries).size !== 3) {
    throw new Error('Configure three distinct private Redis Sentinel endpoints');
  }
  const sentinels = entries.map((entry) => {
    const [host, port, extra] = entry.split(':');
    if (extra || isIP(host ?? '') !== 4 || port !== '26379') {
      throw new Error('Redis Sentinel endpoints must be private IPv4:26379');
    }
    const [a, b] = host!.split('.').map(Number);
    if (!(a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
      || (a === 100 && b! >= 96 && b! <= 111))) {
      throw new Error('Redis Sentinel must use the private campus network');
    }
    return { host: host!, port: 26379 };
  });
  const secretFile = env.CLUSTER_REDIS_PASSWORD_FILE;
  if (!secretFile) throw new Error('Configure CLUSTER_REDIS_PASSWORD_FILE');
  const password = readFileSync(secretFile, 'utf8').trim();
  if (!/^[a-fA-F0-9]{64,128}$/.test(password)) throw new Error('Cluster Redis needs a protected 256-bit hex secret');
  return {
    sentinels, name: 'cubs-campus', password, sentinelPassword: password,
    role: 'master', connectTimeout: 3000, commandTimeout: 5000,
    maxRetriesPerRequest: 1, enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  };
}

let client: Redis | undefined;
export function clusterRedis(): Redis | null {
  if (client) return client;
  const options = clusterRedisOptions();
  if (!options) return null;
  client = new Redis({ ...options, replyMapping: 'legacy' });
  client.on('error', () => console.error('[cubs:cluster] Private coordination service unavailable'));
  return client;
}

export async function clusterReady(): Promise<boolean> {
  const redis = clusterRedis();
  if (!redis) return true;
  try { return await redis.ping() === 'PONG'; } catch { return false; }
}

export async function waitForCluster(): Promise<void> {
  const redis = clusterRedis();
  if (!redis) return;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await clusterReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Campus coordination is unavailable; refusing an isolated API instance');
}
