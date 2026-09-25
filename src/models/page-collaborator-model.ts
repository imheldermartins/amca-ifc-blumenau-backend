import { Model } from "@/repositories/model";
import { type Schema } from "@/db/schemas/index";
import { schemaRegistry } from '@/db/rqlite.generated';

const pageCollaborators = new Model<Schema.PageCollaborator>(schemaRegistry.page_collaborators);
export { pageCollaborators };
