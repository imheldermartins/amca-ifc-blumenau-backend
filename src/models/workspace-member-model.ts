import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import { SoftDeleteSolution } from "@db/soft-delete-solution";

export const workspaceMembers = new Model<Schema.WorkspaceMember>("workspace_members", {
  deleteSolution: new SoftDeleteSolution<Schema.WorkspaceMember>('deleted_at'),
});
