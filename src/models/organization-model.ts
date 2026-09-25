import { Model } from "@/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

export const organizations = new Model<Schema.Organization>(schemaRegistry.organizations);
