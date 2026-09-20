import type { Ability } from "@casl/ability";

export type WorkspaceAction = "read" | "manage";
export type WorkspaceSubject =
  | "Workspace"
  | "WorkspaceRoot"
  | "WorkspaceSettings"
  | "WorkspaceMembers";
export type WorkspaceAbility = Ability<[WorkspaceAction, WorkspaceSubject]>;
