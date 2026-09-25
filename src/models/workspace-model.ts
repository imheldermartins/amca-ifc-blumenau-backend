import { Model } from "@/db/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/generated/schema';

const workspaces = new Model<Schema.Workspace>(schemaRegistry.workspaces);
export { workspaces };
