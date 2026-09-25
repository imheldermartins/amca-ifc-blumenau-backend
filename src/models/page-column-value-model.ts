import { Model } from "@/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

// `data` NÃO entra em jsonColumns de propósito: o ColumnValueCodec é a única
// fronteira de (de)serialização do envelope {value}. Deixar o Model parsear
// também quebraria o contrato decode(data: string) e duplicaria a responsabilidade.
const pageColumnValues = new Model<Schema.PageColumnValue>(schemaRegistry.page_columns_values);
export { pageColumnValues };
