import { Model } from "@/core/db/model";
import { SoftDeleteSolution } from "@db/soft-delete-solution";
import { type Schema } from "@models/schemas/index";

// `data` é a config da coluna (ex.: options do select) -> objeto na leitura.
const pageColumns = new Model<Schema.PageColumn>("page_columns", {
  jsonColumns: ["data"],
  deleteSolution: new SoftDeleteSolution<Schema.PageColumn>("deleted_at"),
});
export { pageColumns };
