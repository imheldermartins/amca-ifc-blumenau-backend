import { Model } from "@/core/db/model";
import { SoftDeleteSolution } from "@db/soft-delete-solution";
import { type Schema } from "@models/schemas/index";

const pages = new Model<Schema.Page>("pages", {
  jsonColumns: ["data"],
  deleteSolution: new SoftDeleteSolution<Schema.Page>("deleted_at"),
});
export { pages };
