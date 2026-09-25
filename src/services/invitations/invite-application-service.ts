import accessInviteStore from "@/db/repositories/access-invite-store";
import type { InviteRecord } from "@/db/repositories/access-invite-store";
import scopedAccess from "@/db/repositories/scoped-access-store";
import { allows, type AccessScope } from "@/services/auth/permissions";
import { inviteFlowRegistry } from "@/services/invitations/invite-flow";
import inviteInputParser from "@/services/invitations/invite-input-parser";
import type {
  InviteApplicationDependencies,
  InviteApplicationResult,
  InviteCreationData,
  InviteInputParserPort,
  InviteRecipientSearchResult,
  NormalizedInviteInput,
} from "@/services/invitations/types/invite-application-service.types";
import { ULID_RE } from "@/utils/ulid";

const invalid = {
  ok: false,
  reason: "validation",
  message: "Dados inválidos",
} as const;
const denied = {
  ok: false,
  reason: "forbidden",
  message: "Acesso não permitido",
} as const;
const conflict = {
  ok: false,
  reason: "conflict",
  message: "A operação não foi concluída. Atualize as informações e confira as permissões.",
} as const;
const serverError = {
  ok: false,
  reason: "server_error",
  message: "Erro no servidor",
} as const;

/**
 * Casos de uso HTTP dos convites. A camada apenas normaliza a entrada, aplica
 * autorização de consulta/revogação e delega a emissão ao fluxo do escopo.
 */
export class InviteApplicationService {
  public constructor(
    private readonly dependencies: InviteApplicationDependencies = {
      authorization: scopedAccess,
      store: accessInviteStore,
      flows: inviteFlowRegistry,
      now: () => new Date(),
    },
    private readonly parser: InviteInputParserPort = inviteInputParser,
  ) {}

  public async createInvite(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
    body: unknown,
  ): Promise<InviteApplicationResult<InviteCreationData>> {
    const input = this.parser.create(body, this.dependencies.now());
    if (!input) return invalid;

    return this.send(scope, scopeId, actorId, input);
  }

  public async inviteMember(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
    body: unknown,
  ): Promise<InviteApplicationResult<InviteCreationData>> {
    const input = this.parser.member(body, this.dependencies.now());
    if (!input) return invalid;

    return this.send(scope, scopeId, actorId, input);
  }

  public async list(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
  ): Promise<InviteApplicationResult<InviteRecord[]>> {
    const grant = await this.dependencies.authorization.get(scope, scopeId, actorId);
    if (!allows(grant, "read", "members") && !allows(grant, "write", "add_members")) {
      return denied;
    }

    return { ok: true, data: await this.dependencies.store.list(scope, scopeId) };
  }

  public async searchRecipient(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
    emailValue: unknown,
  ): Promise<InviteApplicationResult<InviteRecipientSearchResult>> {
    const allowed = await this.dependencies.authorization.can(
      scope,
      scopeId,
      actorId,
      "write",
      "add_members",
    );
    if (!allowed) return denied;

    const email = this.parser.email(emailValue);
    if (!email) return invalid;

    return {
      ok: true,
      data: await this.dependencies.store.exactEmail(email, scope, scopeId),
    };
  }

  public async revoke(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
    inviteId: string,
  ): Promise<InviteApplicationResult<{ expired: true }>> {
    if (!ULID_RE.test(inviteId)) return invalid;

    const allowed = await this.dependencies.authorization.can(
      scope,
      scopeId,
      actorId,
      "write",
      "add_members",
    );
    if (!allowed) return denied;

    const removed = await this.dependencies.store.remove(inviteId, scope, scopeId);
    return removed ? { ok: true, data: { expired: true } } : conflict;
  }

  private async send(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
    input: NormalizedInviteInput,
  ): Promise<InviteApplicationResult<InviteCreationData>> {
    const result = await this.dependencies.flows.for(scope).sendInvite({
      scopeId,
      actorId,
      ...input,
    });

    if (result.ok) return { ok: true, data: result };
    if (result.reason === "forbidden") return denied;
    if (result.reason === "already_member") return conflict;
    if (result.reason === "failed") return serverError;
    return invalid;
  }

}

export default new InviteApplicationService();
