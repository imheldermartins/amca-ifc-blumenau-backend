import { Model } from "@/db/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/generated/schema';

const pageCollaborators = new Model<Schema.PageCollaborator>(schemaRegistry.page_collaborators);
export { pageCollaborators };
