import {createClient} from '@cubs/rqlite-client';
import {fileURLToPath} from 'node:url';
import {schema} from './generated/schema.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

export const db = createClient({
  schema,
  connection: {url: databaseUrl},
  migrations: {directory: fileURLToPath(new URL('./migrations', import.meta.url))},
});
export const client = db;
export {schemaRegistry} from './generated/schema.js';
