import { Model } from "@/db/repositories/model";
import { schemaRegistry } from '@/db/generated/schema';
import { type Schema } from "@/db/schemas/index";

const pages = new Model<Schema.Page>(schemaRegistry.pages);
export { pages };
