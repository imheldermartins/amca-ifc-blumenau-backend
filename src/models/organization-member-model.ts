import { Model } from "@/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

export const organizationMembers = new Model<Schema.OrganizationMember>(schemaRegistry.organization_members);
