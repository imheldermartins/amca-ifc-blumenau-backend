import { ulid } from "ulid";
import db from "@models/index";
import workspaceStore, {
  type WorkspaceMemberSummary,
  type WorkspaceSummary,
} from "@db/workspace-store";
import accessStore, { ULID_RE } from "@db/scoped-access-store";
import type { Schema } from "@/models/schemas/index";
import { isWorkspaceIcon } from "@/services/workspace-icon";

const MAX_WORKSPACE_NAME = 120;

type MutationReason =
  | "validation"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "server_error";
export type WorkspaceMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: MutationReason; message: string };

function cleanWorkspaceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length > 0 && clean.length <= MAX_WORKSPACE_NAME ? clean : null;
}

class WorkspacesController {
  async listForUser(userId: string): Promise<WorkspaceSummary[] | null> {
    try {
      return await workspaceStore.listForUser(userId);
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  async getForUser(workspaceId: string, userId: string): Promise<WorkspaceSummary | null> {
    try {
      return await workspaceStore.getForUser(workspaceId, userId);
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  async createInOrganization(
    userId: string,
    input: { name?: unknown; organizationId?: unknown },
  ): Promise<WorkspaceMutationResult<WorkspaceSummary>> {
    const name = cleanWorkspaceName(input.name);
    if (!name) {
      return { ok: false, reason: "validation", message: "Nome da workspace inválido" };
    }

    const organizationId = typeof input.organizationId === "string" && ULID_RE.test(input.organizationId)
      ? input.organizationId
      : null;
    if (!organizationId) return {
      ok: false,
      reason: "validation",
      message: "Escolha uma organização para criar a workspace",
    };

    try {
      if (!await accessStore.can("organization", organizationId, userId, "write", "create")) {
        return { ok: false, reason: "forbidden", message: "Acesso não permitido" };
      }

      const workspaceId = ulid();
      const committed = await workspaceStore.createInOrganization({
        workspaceId,
        workspaceName: name,
        workspaceIcon: "lucide:boxes",
        organizationId,
        ownerId: userId,
        rootTitle: name,
        membershipId: ulid(),
      });
      if (!committed) {
        return { ok: false, reason: "conflict", message: "Não foi possível criar a workspace" };
      }

      const workspace = await workspaceStore.getForUser(workspaceId, userId);
      return workspace
        ? { ok: true, data: workspace }
        : { ok: false, reason: "server_error", message: "Erro no servidor" };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "conflict", message: "Não foi possível criar a workspace" };
    }
  }

  async updateSettings(
    workspaceId: string,
    userId: string,
    input: { name?: unknown; icon?: unknown },
  ): Promise<WorkspaceMutationResult<WorkspaceSummary>> {
    const payload: UpdateValues<Schema.Workspace> = {};
    if (input.name !== undefined) {
      const name = cleanWorkspaceName(input.name);
      if (!name) return { ok: false, reason: "validation", message: "Nome da workspace inválido" };
      payload.name = name;
    }
    if (input.icon !== undefined) {
      if (!isWorkspaceIcon(input.icon)) {
        return { ok: false, reason: "validation", message: "Ícone da workspace inválido" };
      }
      payload.icon = input.icon;
    }
    if (Object.keys(payload).length === 0) {
      return { ok: false, reason: "validation", message: "Nenhuma alteração informada" };
    }

    try {
      const updated = await workspaceStore.updateSettings(workspaceId, userId, payload);
      if (!updated) return { ok: false, reason: "not_found", message: "Workspace não encontrada" };
      const workspace = await workspaceStore.getForUser(workspaceId, userId);
      return workspace
        ? { ok: true, data: workspace }
        : { ok: false, reason: "not_found", message: "Workspace não encontrada" };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMemberSummary[] | null> {
    try {
      return await workspaceStore.listMembers(workspaceId);
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  async updateMemberRole(
    workspaceId: string,
    actorUserId: string,
    userId: string,
    role: unknown,
  ): Promise<WorkspaceMutationResult<WorkspaceMemberSummary[]>> {
    if (typeof role !== "string" || !ULID_RE.test(role)) {
      return { ok: false, reason: "validation", message: "Role inválida" };
    }

    try {
      if (!await workspaceStore.updateMemberRole(workspaceId, actorUserId, userId, role)) {
        return { ok: false, reason: "forbidden", message: "Não é possível atribuir esta role ao membro." };
      }

      return { ok: true, data: await workspaceStore.listMembers(workspaceId) };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async getPageRoot(workspaceId: string, userId: string): Promise<Schema.Page | null> {
    try {
      const workspace = await workspaceStore.getForUser(workspaceId, userId);
      if (!workspace) return null;
      return db.pages.find({ id: workspace.pageRootId } as LookupValues<Schema.Page>);
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

export default new WorkspacesController();
