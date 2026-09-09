import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

export const organizations = new Model<Schema.Organization>("organizations", {
  jsonColumns: ["data"],
});
