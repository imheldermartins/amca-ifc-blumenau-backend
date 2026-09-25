import type { InviteRecord } from "@/repositories/access-invite-repository";
import type { ScopeAccess } from "@/services/auth/permissions";
import type { AccessScope } from "@/services/auth/permissions";
import type {
  SendInviteInput,
  SendInviteResult,
} from "@/services/invitations/types/invite-flow.types";

export type InviteApplicationFailureReason =
  | "validation"
  | "forbidden"
  | "conflict"
  | "server_error";

export type InviteApplicationResult<T> =
  | { ok: true; data: T }
  | {
    ok: false;
    reason: InviteApplicationFailureReason;
    message: string;
  };

export type InviteCreationData = Extract<SendInviteResult, { ok: true }>;

export interface NormalizedInviteInput {
  roleId: string | null | undefined;
  recipientEmail: string | null;
  expiresAt: string | null;
  acceptanceLimit: number | null;
}

export interface InviteInputParserPort {
  create(body: unknown, now: Date): NormalizedInviteInput | null;
  member(body: unknown, now: Date): NormalizedInviteInput | null;
  email(value: unknown): string | null;
}

export interface InviteRecipientSearchResult {
  found: boolean;
  user: {
    id: string;
    name: string | null;
    email: string;
    verified: boolean;
  } | null;
  isMember: boolean;
}

export interface InviteAuthorizationPort {
  get(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
  ): Promise<ScopeAccess | null>;
  can(
    scope: AccessScope,
    scopeId: string,
    actorId: string,
    kind: "write",
    action: "add_members",
  ): Promise<boolean>;
}

export interface InviteStorePort {
  list(scope: AccessScope, scopeId: string): Promise<InviteRecord[]>;
  exactEmail(
    email: string,
    scope: AccessScope,
    scopeId: string,
  ): Promise<InviteRecipientSearchResult>;
  remove(
    inviteId: string,
    scope: AccessScope,
    scopeId: string,
  ): Promise<boolean>;
}

export interface InviteSenderPort {
  sendInvite(input: SendInviteInput): Promise<SendInviteResult>;
}

export interface InviteFlowRegistryPort {
  for(scope: AccessScope): InviteSenderPort;
}

export interface InviteApplicationDependencies {
  authorization: InviteAuthorizationPort;
  store: InviteStorePort;
  flows: InviteFlowRegistryPort;
  now: () => Date;
}
