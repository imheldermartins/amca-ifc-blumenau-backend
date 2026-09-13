import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";
import { SoftDeleteSolution } from "@db/soft-delete-solution";

const pageCollaborators = new Model<Schema.PageCollaborator>("page_collaborators", {
  deleteSolution: new SoftDeleteSolution<Schema.PageCollaborator>('deleted_at'),
});
export { pageCollaborators };
