import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

// `data` é a config da coluna (ex.: options do select) -> objeto na leitura.
const pageColumns = new Model<Schema.PageColumn>("page_columns", { jsonColumns: ["data"] });
export { pageColumns };
