import { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

export const organizationMembers = new Model<Schema.OrganizationMember>("organization_members");
