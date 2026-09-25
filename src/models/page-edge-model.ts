import { Model } from "@/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

const pageEdges = new Model<Schema.PageEdge>(schemaRegistry.page_edges);
export { pageEdges };
