import { ulid } from "ulid";
import db from "@models/index";
import workspaceStore, {
  type WorkspaceKeyRecord,
  type WorkspaceMemberSummary,
  type WorkspaceSummary,
} from "@db/workspace-store";
import organizationStore from "@db/organization-store";
import type { Schema } from "@/models/schemas/index";
import {
  WORKSPACE_KEY_ALGORITHM,
  hashWorkspaceKey,
  isWorkspaceKey,
  normalizeWorkspaceEmail,
  normalizeWorkspaceName,
} from "@/services/workspace-key";
import { isWorkspaceIcon } from "@/services/workspace-icon";

const MAX_WORKSPACE_NAME = 120;

type MutationReason =
  | "validation"
  | "invalid_key"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "server_error";
export type WorkspaceMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: MutationReason; message: string };

interface ValidatedKey {
  record: WorkspaceKeyRecord;
  user: Schema.User;
  email: string;
  name: string;
}

export interface WorkspaceKeyValidation {
  valid: boolean;
  purpose?: Schema.WorkspaceKeyPurpose;
  role?: Schema.WorkspaceRole;
  workspace?: { id: string; name: string | null };
}

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

  async validateAccessKey(
    key: unknown,
    userId: string,
    purpose?: Schema.WorkspaceKeyPurpose,
  ): Promise<WorkspaceKeyValidation> {
    try {
      const validated = await this.resolveKey(key, userId, purpose);
      if (!validated) return { valid: false };

      const { record } = validated;
      return {
        valid: true,
        purpose: record.purpose,
        role: record.purpose === "create" ? "superadmin" : "member",
        ...(record.workspace_id && {
          workspace: { id: record.workspace_id, name: record.workspace_name },
        }),
      };
    } catch (error) {
      this.log(error);
      return { valid: false };
    }
  }

  async createWithKey(
    userId: string,
    input: { name?: unknown; key?: unknown; organizationId?: unknown },
  ): Promise<WorkspaceMutationResult<WorkspaceSummary>> {
    const name = cleanWorkspaceName(input.name);
    if (!name) {
      return { ok: false, reason: "validation", message: "Nome da workspace inválido" };
    }

    const organizationId = input.organizationId === undefined || input.organizationId === null
      || input.organizationId === ""
      ? null
      : typeof input.organizationId === "string"
        && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(input.organizationId)
        ? input.organizationId
        : undefined;
    if (organizationId === undefined) {
      return { ok: false, reason: "validation", message: "Organização inválida" };
    }

    try {
      const validated = await this.resolveKey(input.key, userId, "create");
      if (!validated) {
        return { ok: false, reason: "invalid_key", message: "Chave de workspace inválida" };
      }

      if (organizationId) {
        const membership = await organizationStore.getMembership(organizationId, userId);
        if (!membership || membership.role !== "superadmin") {
          return { ok: false, reason: "forbidden", message: "Acesso não permitido" };
        }
      } else if (await workspaceStore.hasCreatedWorkspace(userId)) {
        return {
          ok: false,
          reason: "conflict",
          message: "Workspaces adicionais precisam pertencer a uma organização",
        };
      }

      const workspaceId = ulid();
      const committed = await workspaceStore.createWithKey({
        workspaceId,
        workspaceName: name,
        workspaceIcon: "lucide:boxes",
        organizationId,
        ownerId: userId,
        rootTitle: name,
        membershipId: ulid(),
        keyId: validated.record.id,
        keyHash: validated.record.key_hash,
        keyLinkId: ulid(),
        issuedEmail: validated.email,
        issuedName: validated.name,
      });
      if (!committed) {
        return { ok: false, reason: "conflict", message: "Chave já utilizada ou expirada" };
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

  async joinWithKey(
    userId: string,
    key: unknown,
  ): Promise<WorkspaceMutationResult<WorkspaceSummary>> {
    try {
      const validated = await this.resolveKey(key, userId, "join");
      const workspaceId = validated?.record.workspace_id;
      if (!validated || !workspaceId) {
        return { ok: false, reason: "invalid_key", message: "Chave de workspace inválida" };
      }

      if (await workspaceStore.getMembership(workspaceId, userId)) {
        return { ok: false, reason: "conflict", message: "Usuário já pertence à workspace" };
      }

      const rootId = ulid();
      const firstName = validated.user.name?.trim().split(/\s+/)[0];
      const committed = await workspaceStore.joinWithKey({
        workspaceId,
        ownerId: userId,
        pageRootId: rootId,
        rootTitle: firstName ? `${firstName} base de dados` : "Base de dados",
        membershipId: ulid(),
        keyId: validated.record.id,
        keyHash: validated.record.key_hash,
        issuedEmail: validated.email,
        issuedName: validated.name,
      });
      if (!committed) {
        return { ok: false, reason: "conflict", message: "Chave já utilizada ou expirada" };
      }

      const workspace = await workspaceStore.getForUser(workspaceId, userId);
      return workspace
        ? { ok: true, data: workspace }
        : { ok: false, reason: "server_error", message: "Erro no servidor" };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "conflict", message: "Não foi possível entrar na workspace" };
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
      const updated = await db.workspaces.update(
        payload,
        { id: workspaceId } as LookupValues<Schema.Workspace>,
      );
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
    if (role !== "superadmin" && role !== "member") {
      return { ok: false, reason: "validation", message: "Role inválida" };
    }

    try {
      const [actor, target] = await Promise.all([
        workspaceStore.getMembership(workspaceId, actorUserId),
        workspaceStore.getMembership(workspaceId, userId),
      ]);
      if (!actor) return { ok: false, reason: "not_found", message: "Workspace não encontrada" };
      if (actor.role !== "superadmin") {
        return { ok: false, reason: "forbidden", message: "Acesso não permitido" };
      }
      if (!target) return { ok: false, reason: "not_found", message: "Membro não encontrado" };
      if (target.role !== role) {
        const updated = await workspaceStore.updateMemberRole(
          workspaceId,
          actorUserId,
          userId,
          role,
        );
        if (!updated) {
          if (target.role === "superadmin" && role === "member") {
            return {
              ok: false,
              reason: "conflict",
              message: "A workspace precisa manter ao menos um superadmin",
            };
          }
          return { ok: false, reason: "not_found", message: "Membro não encontrado" };
        }
      }

      return { ok: true, data: await workspaceStore.listMembers(workspaceId) };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro no servidor" };
    }
  }

  async getPageRoot(workspaceId: string, userId: string): Promise<Schema.Page | null> {
    try {
      const membership = await workspaceStore.getMembership(workspaceId, userId);
      if (!membership) return null;
      return db.pages.find({
        id: membership.page_root_id,
        owner_id: userId,
      } as LookupValues<Schema.Page>);
    } catch (error) {
      this.log(error);
      return null;
    }
  }

  private async resolveKey(
    key: unknown,
    userId: string,
    purpose?: Schema.WorkspaceKeyPurpose,
  ): Promise<ValidatedKey | null> {
    if (!isWorkspaceKey(key)) return null;

    const [record, user] = await Promise.all([
      workspaceStore.getAccessKey(hashWorkspaceKey(key)),
      db.users.find({ id: userId } as LookupValues<Schema.User>),
    ]);
    if (!record || record.algorithm_version !== WORKSPACE_KEY_ALGORITHM || !user?.name) return null;
    if (record.consumed_at || record.revoked_at || Date.parse(record.expires_at) <= Date.now()) {
      return null;
    }
    if (purpose && record.purpose !== purpose) return null;
    if (record.purpose === "create" && record.workspace_id) return null;
    if (record.purpose === "join" && !record.workspace_id) return null;

    const email = normalizeWorkspaceEmail(user.email);
    const name = normalizeWorkspaceName(user.name);
    if (normalizeWorkspaceEmail(record.issued_to_email) !== email) return null;
    if (normalizeWorkspaceName(record.issued_to_name) !== name) return null;

    return { record, user, email, name };
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

export default new WorkspacesController();
