import { Model } from "@/db/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/generated/schema';

const pageEdges = new Model<Schema.PageEdge>(schemaRegistry.page_edges);
export { pageEdges };
