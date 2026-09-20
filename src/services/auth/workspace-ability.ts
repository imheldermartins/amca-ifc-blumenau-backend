import { Ability, AbilityBuilder } from "@casl/ability";
import { allows } from "./permissions.js";
import type { ScopeAccess } from "@/services/auth/types/access.types";
import type { WorkspaceAbility } from "@/services/auth/types/workspace-ability.types";
export type { WorkspaceAbility, WorkspaceAction, WorkspaceSubject } from "@/services/auth/types/workspace-ability.types";

/** Matriz única de autorização do módulo de workspace no backend. */
export function defineWorkspaceAbility(access: Pick<ScopeAccess,"permissions"> | string | null): WorkspaceAbility {
  const { can, build } = new AbilityBuilder<WorkspaceAbility>(Ability);

  if (typeof access === "object" && allows(access,"read","view")) {
    can("read", "Workspace");
    can("read", "WorkspaceRoot");
  }

  if (typeof access === "object" && allows(access,"write","update")) {
    can("manage", "WorkspaceSettings");
  }
  if (typeof access === "object" && (allows(access,"read","members") || allows(access,"write","promote_members"))) {
    can("manage", "WorkspaceMembers");
  }

  return build();
}
