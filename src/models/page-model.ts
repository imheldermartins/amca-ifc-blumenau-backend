import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

const pages = new Model<Schema.Page>("pages", { jsonColumns: ["data"] });
export { pages };
