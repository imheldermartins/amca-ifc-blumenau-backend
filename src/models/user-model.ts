import { Model } from "@/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

const users = new Model<Schema.User>(schemaRegistry.users);
export { users };
