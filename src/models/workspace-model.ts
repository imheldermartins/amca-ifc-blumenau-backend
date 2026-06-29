import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

const workspaces = new Model<Schema.Workspace>("workspaces", { jsonColumns: ["data"] });
export { workspaces };