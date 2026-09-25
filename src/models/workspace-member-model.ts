import { Model } from "@/db/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/generated/schema';

export const workspaceMembers = new Model<Schema.WorkspaceMember>(schemaRegistry.workspace_members);
