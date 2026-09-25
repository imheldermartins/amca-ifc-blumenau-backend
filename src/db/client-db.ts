import {createClient} from '@cubs/rqlite-client';
import {createLegacyTransport} from '@cubs/rqlite-client/compat';
import {fileURLToPath} from 'node:url';
import {schema, schemaRegistry} from './rqlite.generated.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

export const db = createClient({
  schema,
  connection: {url: databaseUrl},
  migrations: {directory: fileURLToPath(new URL('./migrations', import.meta.url))},
});
export const client = db;
export {schemaRegistry};

// Os repositories do Cub's usam o executor do pacote para as guardas
// transacionais de domínio. A conexão continua centralizada neste arquivo.
const transport = createLegacyTransport(db.sql);
type LegacyTransport = ReturnType<typeof createLegacyTransport>;

export const rqlite: LegacyTransport['rqlite'] = transport.rqlite;
const sql: LegacyTransport['sql'] = transport.sql;
export default sql;

export {parseRqliteResults} from '@cubs/rqlite-client/compat';
