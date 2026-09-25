import { Model } from "@/db/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/generated/schema';

export const organizationMembers = new Model<Schema.OrganizationMember>(schemaRegistry.organization_members);
