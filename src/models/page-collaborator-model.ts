import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

const pageCollaborators = new Model<Schema.PageCollaborator>("page_collaborators");
export { pageCollaborators };
