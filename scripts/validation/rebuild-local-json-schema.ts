import { readdir } from 'node:fs/promises';

// This is deliberately limited to the local development URL, never a remote DB.
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.origin !== 'http://127.0.0.1:4001' || url.pathname !== '/' || url.username || url.password || url.search) {
  throw new Error('Reset refused: expected exactly http://127.0.0.1:4001');
}

async function request(endpoint: 'query' | 'execute', statements: unknown[], transaction = false) {
  const response = await fetch(`${url.origin}/db/${endpoint}?${transaction ? 'transaction&' : ''}${endpoint === 'query' ? 'level=strong&' : ''}timings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(statements),
  });
  if (!response.ok) throw new Error(`rqlite HTTP ${response.status}`);
  const payload = await response.json() as { error?: string; results?: Array<{ error?: string; values?: unknown[][] }> };
  if (payload.error || payload.results?.some(result => result.error)) throw new Error(JSON.stringify(payload));
  return payload.results ?? [];
}

const [catalog] = await request('query', ["SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"]);
const names = (catalog?.values ?? []).map(row => String(row[0]));
if (names.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('Unexpected table identifier');
console.log(JSON.stringify({ target: url.origin, tables: names, reset: process.argv.includes('--reset') }));
if (!process.argv.includes('--reset')) process.exit(0);

const dependencies = new Map<string, Set<string>>();
for (const name of names) {
  const [foreignKeys] = await request('query', [`PRAGMA foreign_key_list("${name}")`]);
  dependencies.set(name, new Set((foreignKeys?.values ?? []).map(row => String(row[2])).filter(parent => parent !== name)));
}
const remaining = new Set(names), order: string[] = [];
while (remaining.size) {
  const children = [...remaining].filter(name => ![...remaining].some(other => other !== name && dependencies.get(other)?.has(name)));
  if (!children.length) throw new Error('Reset refused: cyclic foreign-key graph');
  children.forEach(name => { order.push(name); remaining.delete(name); });
}
await request('execute', order.map(name => `DROP TABLE "${name}"`), true);
console.log(`Removed ${order.length} tables from the authorized local development database.`);

if (process.argv.includes('--rehearse')) {
  const directory = new URL('../../src/db/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.ts')).sort()) {
    const { migration } = await import(new URL(file, directory).href) as { migration: { up: readonly string[] } };
    await request('execute', [...migration.up], true);
    console.log(`Rehearsed ${file}`);
  }
  const [violations] = await request('query', ['PRAGMA foreign_key_check']);
  if (violations?.values?.length) throw new Error('Foreign-key violations after rehearsal');
}
