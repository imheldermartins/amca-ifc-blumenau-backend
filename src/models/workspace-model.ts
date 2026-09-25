import { Model } from "@/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

const workspaces = new Model<Schema.Workspace>(schemaRegistry.workspaces);
export { workspaces };
