import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

const pageEdges = new Model<Schema.PageEdge>("page_edges");
export { pageEdges };
