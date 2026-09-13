import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";
import { SoftDeleteSolution } from "@db/soft-delete-solution";

export const organizationMembers = new Model<Schema.OrganizationMember>("organization_members", {
  deleteSolution: new SoftDeleteSolution<Schema.OrganizationMember>('deleted_at'),
});
