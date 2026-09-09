import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

export const workspaceAccessKeys = new Model<Schema.WorkspaceAccessKey>(
  "workspace_access_keys",
);
