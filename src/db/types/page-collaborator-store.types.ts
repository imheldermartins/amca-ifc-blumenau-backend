import type { Schema } from "@/db/schemas/index";

export interface WorkspaceMembershipRow {
  workspace_id: NonEmptyString;
}

export interface PageCollaboratorStoreContract {
  listCollaborators(pageId: NonEmptyString): Promise<Schema.PageCollaboratorSummary[]>;
  listCandidates(
    pageId: NonEmptyString,
    workspaceId: NonEmptyString,
    email: string,
  ): Promise<Schema.PageCollaboratorSummary[]>;
  findLink(pageId: NonEmptyString, userId: NonEmptyString): Promise<Schema.PageCollaborator | null>;
  resolveWorkspaceId(pageId: NonEmptyString): Promise<NonEmptyString | null>;
}
