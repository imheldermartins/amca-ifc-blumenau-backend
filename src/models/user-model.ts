import { Model } from "@/db/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/generated/schema';

const users = new Model<Schema.User>(schemaRegistry.users);
export { users };
