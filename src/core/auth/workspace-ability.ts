import { Ability, AbilityBuilder } from "@casl/ability";
import type { Schema } from "@/models/schemas/index";

export type WorkspaceAction = "read" | "manage";
export type WorkspaceSubject =
  | "Workspace"
  | "WorkspaceRoot"
  | "WorkspaceSettings"
  | "WorkspaceMembers";
export type WorkspaceAbility = Ability<[WorkspaceAction, WorkspaceSubject]>;

/** Matriz única de autorização do módulo de workspace no backend. */
export function defineWorkspaceAbility(role: Schema.WorkspaceRole | null): WorkspaceAbility {
  const { can, build } = new AbilityBuilder<WorkspaceAbility>(Ability);

  if (role === "superadmin" || role === "member") {
    can("read", "Workspace");
    can("read", "WorkspaceRoot");
  }

  if (role === "superadmin") {
    can("manage", "WorkspaceSettings");
    can("manage", "WorkspaceMembers");
  }

  return build();
}
