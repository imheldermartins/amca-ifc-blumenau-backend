import type { Store } from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { clusterRedis } from '@/services/cluster/cluster-redis';

// One atomic operation, also after Sentinel failover (no cached script SHA).
const INCREMENT = `local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {n, ttl}`;
const DECREMENT = `if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then
return redis.call('DECR', KEYS[1]) end return 0`;

export class ClusterRateStore implements Store {
  readonly localKeys = false;
  private windowMs = 60_000;
  constructor(private readonly redis: Redis, readonly prefix: string) {}
  init(options: { windowMs: number }): void { this.windowMs = options.windowMs; }
  async increment(key: string) {
    const [hits, ttl] = await this.redis.eval(INCREMENT, 1, this.prefix + key, this.windowMs) as [number, number];
    return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
  }
  async decrement(key: string): Promise<void> { await this.redis.eval(DECREMENT, 1, this.prefix + key); }
  async resetKey(key: string): Promise<void> { await this.redis.del(this.prefix + key); }
}

export function clusterRateStore(scope: string): { store?: Store } {
  const redis = clusterRedis();
  return redis ? { store: new ClusterRateStore(redis, `cubs:rate:${scope}:`) } : {};
}
