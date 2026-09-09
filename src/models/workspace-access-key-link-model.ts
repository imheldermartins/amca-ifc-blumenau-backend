import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

export const workspaceAccessKeyLinks = new Model<Schema.WorkspaceAccessKeyLink>(
  "workspace_access_key_links",
);
