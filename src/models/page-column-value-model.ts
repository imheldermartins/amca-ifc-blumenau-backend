import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

// `data` NÃO entra em jsonColumns de propósito: o ColumnValueCodec é a única
// fronteira de (de)serialização do envelope {value}. Deixar o Model parsear
// também quebraria o contrato decode(data: string) e duplicaria a responsabilidade.
const pageColumnValues = new Model<Schema.PageColumnValue>("page_columns_values");
export { pageColumnValues };
