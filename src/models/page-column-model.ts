import { Model } from "@/repositories/model";
import { schemaRegistry } from '@/db/rqlite.generated';
import { type Schema } from "@/db/schemas/index";

// `data` é a config da coluna (ex.: options do select) -> objeto na leitura.
const pageColumns = new Model<Schema.PageColumn>(schemaRegistry.page_columns);
export { pageColumns };
