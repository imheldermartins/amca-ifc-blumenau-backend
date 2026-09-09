import { ulid } from "ulid";
import organizationStore, {
  type OrganizationSummary,
  type OrganizationWorkspaceUser,
} from "@db/organization-store";
import workspaceStore, { type WorkspaceSummary } from "@db/workspace-store";

const MAX_ORGANIZATION_NAME = 120;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

type OrganizationMutationReason =
  | "validation"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "server_error";

export type OrganizationMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: OrganizationMutationReason; message: string };

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length > 0 && clean.length <= MAX_ORGANIZATION_NAME ? clean : null;
}

function searchPatterns(value: unknown): { prefix: string; contains: string } | null {
  if (value !== undefined && typeof value !== "string") return null;
  const clean = (value ?? "").trim().toLocaleLowerCase("pt-BR");
  if (clean.length > 120) return null;
  const escaped = clean.replace(/[\\%_]/g, "\\$&");
  return { prefix: `${escaped}%`, contains: `%${escaped}%` };
}

class OrganizationsController {
  async listForUser(userId: string): Promise<OrganizationSummary[] | null> {
    try {
      return await organizationStore.listForUser(userId);
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  async create(
    userId: string,
    input: { name?: unknown; workspaceId?: unknown },
  ): Promise<OrganizationMutationResult<OrganizationSummary>> {
    const name = cleanName(input.name);
    if (!name || typeof input.workspaceId !== "string" || !ULID_RE.test(input.workspaceId)) {
      return { ok: false, reason: "validation", message: "Dados da organização inválidos" };
    }

    try {
      const workspace = await workspaceStore.getForUser(input.workspaceId, userId);
      if (!workspace) {
        return { ok: false, reason: "not_found", message: "Workspace não encontrada" };
      }
      if (workspace.role !== "superadmin") {
        return { ok: false, reason: "forbidden", message: "Acesso não permitido" };
      }
      if (workspace.organizationId) {
        return { ok: false, reason: "conflict", message: "Workspace já vinculada a uma organização" };
      }

      const organizationId = ulid();
      const committed = await organizationStore.createWithWorkspace({
        organizationId,
        organizationName: name,
        membershipId: ulid(),
        ownerId: userId,
        workspaceId: input.workspaceId,
      });
      if (!committed) {
        return { ok: false, reason: "conflict", message: "Não foi possível vincular a workspace" };
      }

      const organizations = await organizationStore.listForUser(userId);
      const organization = organizations.find((candidate) => candidate.id === organizationId);
      return organization
        ? { ok: true, data: organization }
        : { ok: false, reason: "server_error", message: "Erro no servidor" };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async linkWorkspace(
    organizationId: string,
    workspaceId: string,
    userId: string,
  ): Promise<OrganizationMutationResult<WorkspaceSummary>> {
    if (!ULID_RE.test(organizationId) || !ULID_RE.test(workspaceId)) {
      return { ok: false, reason: "validation", message: "Identificador inválido" };
    }

    try {
      const [organizationMembership, workspace] = await Promise.all([
        organizationStore.getMembership(organizationId, userId),
        workspaceStore.getForUser(workspaceId, userId),
      ]);
      if (!organizationMembership || !workspace) {
        return { ok: false, reason: "not_found", message: "Organização ou workspace não encontrada" };
      }
      if (organizationMembership.role !== "superadmin" || workspace.role !== "superadmin") {
        return { ok: false, reason: "forbidden", message: "Acesso não permitido" };
      }
      if (workspace.organizationId) {
        return { ok: false, reason: "conflict", message: "Workspace já vinculada a uma organização" };
      }

      const committed = await organizationStore.linkWorkspace(organizationId, workspaceId, userId);
      if (!committed) {
        return { ok: false, reason: "conflict", message: "Não foi possível vincular a workspace" };
      }
      const updated = await workspaceStore.getForUser(workspaceId, userId);
      return updated
        ? { ok: true, data: updated }
        : { ok: false, reason: "server_error", message: "Erro no servidor" };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async searchWorkspaceUsers(
    organizationId: string,
    workspaceId: string,
    userId: string,
    query: unknown,
  ): Promise<OrganizationMutationResult<OrganizationWorkspaceUser[]>> {
    const patterns = searchPatterns(query);
    if (!ULID_RE.test(organizationId) || !ULID_RE.test(workspaceId) || !patterns) {
      return { ok: false, reason: "validation", message: "Busca inválida" };
    }

    try {
      const [organizationMembership, workspace] = await Promise.all([
        organizationStore.getMembership(organizationId, userId),
        workspaceStore.getForUser(workspaceId, userId),
      ]);
      if (!organizationMembership || !workspace || workspace.organizationId !== organizationId) {
        return { ok: false, reason: "not_found", message: "Organização ou workspace não encontrada" };
      }
      if (organizationMembership.role !== "superadmin" || workspace.role !== "superadmin") {
        return { ok: false, reason: "forbidden", message: "Acesso não permitido" };
      }

      return {
        ok: true,
        data: await organizationStore.searchWorkspaceUsers(
          organizationId,
          workspaceId,
          userId,
          patterns.prefix,
          patterns.contains,
        ),
      };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async addWorkspaceUser(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<OrganizationMutationResult<OrganizationWorkspaceUser>> {
    if (![organizationId, workspaceId, targetUserId].every((id) => ULID_RE.test(id))) {
      return { ok: false, reason: "validation", message: "Identificador inválido" };
    }

    try {
      const [organizationMembership, workspace, target] = await Promise.all([
        organizationStore.getMembership(organizationId, actorUserId),
        workspaceStore.getForUser(workspaceId, actorUserId),
        organizationStore.getWorkspaceUser(
          organizationId,
          workspaceId,
          actorUserId,
          targetUserId,
        ),
      ]);
      if (!organizationMembership || !workspace || workspace.organizationId !== organizationId) {
        return { ok: false, reason: "not_found", message: "Organização ou workspace não encontrada" };
      }
      if (organizationMembership.role !== "superadmin" || workspace.role !== "superadmin") {
        return { ok: false, reason: "forbidden", message: "Acesso não permitido" };
      }
      if (!target) {
        return { ok: false, reason: "not_found", message: "Usuário não encontrado" };
      }
      if (target.organizationRole && target.workspaceRole) {
        return { ok: false, reason: "conflict", message: "Usuário já pertence à organização e à workspace" };
      }

      const firstName = target.name?.trim().split(/\s+/)[0];
      const committed = await organizationStore.addWorkspaceUser({
        organizationId,
        workspaceId,
        actorUserId,
        targetUserId,
        ...(!target.organizationRole && { organizationMembershipId: ulid() }),
        ...(!target.workspaceRole && {
          workspaceMembershipId: ulid(),
          pageRootId: ulid(),
          pageRootTitle: firstName ? `${firstName} base de dados` : "Base de dados",
        }),
      });
      if (!committed) {
        return { ok: false, reason: "conflict", message: "Não foi possível adicionar o usuário" };
      }

      const added = await organizationStore.getWorkspaceUser(
        organizationId,
        workspaceId,
        actorUserId,
        targetUserId,
      );
      return added
        ? { ok: true, data: added }
        : { ok: false, reason: "server_error", message: "Erro no servidor" };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

export default new OrganizationsController();
