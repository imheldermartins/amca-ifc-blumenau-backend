import { Model } from "@/db/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/generated/schema';

export const organizations = new Model<Schema.Organization>(schemaRegistry.organizations);
