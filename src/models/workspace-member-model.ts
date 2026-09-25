import { Model } from "@/repositories/model";
import type { Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

export const workspaceMembers = new Model<Schema.WorkspaceMember>(schemaRegistry.workspace_members);
