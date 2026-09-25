import { Model } from "@/repositories/model";
import { schemaRegistry } from '@/db/rqlite.generated';
import { type Schema } from "@/db/schemas/index";

const pages = new Model<Schema.Page>(schemaRegistry.pages);
export { pages };
