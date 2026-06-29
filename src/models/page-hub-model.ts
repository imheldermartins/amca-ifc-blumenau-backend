import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

const pageHubs = new Model<Schema.PageHub>("page_hubs");
export { pageHubs };
