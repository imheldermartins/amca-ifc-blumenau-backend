import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

export const workspaceMembers = new Model<Schema.WorkspaceMember>("workspace_members");
