import {createLegacyTransport} from '@cubs/rqlite-client/compat';
import {db} from './client-db.js';

export {parseRqliteResults} from '@cubs/rqlite-client/compat';
const transport = createLegacyTransport(db.sql);
type LegacyTransport = ReturnType<typeof createLegacyTransport>;
export const rqlite: LegacyTransport['rqlite'] = transport.rqlite;
const sql: LegacyTransport['sql'] = transport.sql;
export default sql;
