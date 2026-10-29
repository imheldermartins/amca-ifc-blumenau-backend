import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { clusterRedisOptions } from './cluster-redis.js';

const folder = mkdtempSync(join(tmpdir(), 'cubs-cluster-config-'));
const secret = join(folder, 'secret.hex');
writeFileSync(secret, 'a'.repeat(64));
afterAll(() => rmSync(folder, { recursive: true }));
const valid = { CUBS_CLUSTER_ENABLED: 'true',
  CLUSTER_REDIS_SENTINELS: '100.96.0.1:26379,100.96.0.2:26379,100.96.0.3:26379',
  CLUSTER_REDIS_PASSWORD_FILE: secret };

describe('campus coordination configuration', () => {
  it('keeps a single server independent of the cluster service', () => {
    expect(clusterRedisOptions({})).toBeNull();
  });
  it('requires three distinct private sentinels and a protected secret', () => {
    const config = clusterRedisOptions(valid)!;
    expect(config.sentinels).toHaveLength(3);
    expect(config.name).toBe('cubs-campus');
    expect(config.password).toBe('a'.repeat(64));
    for (const endpoints of ['', '100.96.0.1:26379',
      '100.96.0.1:26379,100.96.0.1:26379,100.96.0.3:26379',
      '1.1.1.1:26379,100.96.0.2:26379,100.96.0.3:26379',
      '100.96.0.1:6379,100.96.0.2:26379,100.96.0.3:26379']) {
      expect(() => clusterRedisOptions({ ...valid, CLUSTER_REDIS_SENTINELS: endpoints })).toThrow();
    }
    expect(() => clusterRedisOptions({ ...valid, CLUSTER_REDIS_PASSWORD_FILE: '' })).toThrow();
  });
});
