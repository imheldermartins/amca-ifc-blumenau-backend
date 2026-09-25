import { ULID_RE } from "@/utils/ulid";
import type {
  InviteInputParserPort,
  NormalizedInviteInput,
} from "@/services/invitations/types/invite-application-service.types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_ACCEPTANCE_LIMIT = 100_000;

/** Normaliza apenas os payloads públicos de emissão de convite. */
export class InviteInputParser implements InviteInputParserPort {
  public create(body: unknown, now: Date): NormalizedInviteInput | null {
    const value = this.asRecord(body);
    if (!value) return null;

    const recipientEmail = value.recipientEmail === undefined
      || value.recipientEmail === null
      || value.recipientEmail === ""
      ? null
      : this.email(value.recipientEmail);
    if (recipientEmail === null && value.recipientEmail !== undefined
      && value.recipientEmail !== null && value.recipientEmail !== "") return null;

    const roleId = value.roleId;
    if (roleId !== undefined && roleId !== null
      && (typeof roleId !== "string" || !ULID_RE.test(roleId))) return null;

    const expiresIn = value.expiresIn ?? "24h";
    if (expiresIn !== "24h" && expiresIn !== "7d" && expiresIn !== "never") return null;

    const acceptanceLimit = this.acceptanceLimit(value.acceptanceLimit);
    if (acceptanceLimit === undefined) return null;

    return {
      roleId: roleId as string | null | undefined,
      recipientEmail,
      expiresAt: expiresIn === "never"
        ? null
        : new Date(now.getTime() + (expiresIn === "7d" ? 7 : 1) * ONE_DAY_MS).toISOString(),
      acceptanceLimit,
    };
  }

  public member(body: unknown, now: Date): NormalizedInviteInput | null {
    const value = this.asRecord(body);
    if (!value) return null;

    const recipientEmail = this.email(value.email);
    if (!recipientEmail) return null;

    const roleId = value.roleId;
    if (roleId !== undefined && (typeof roleId !== "string" || !ULID_RE.test(roleId))) {
      return null;
    }

    return {
      roleId: roleId as string | undefined,
      recipientEmail,
      expiresAt: new Date(now.getTime() + ONE_DAY_MS).toISOString(),
      acceptanceLimit: 1,
    };
  }

  public email(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    return EMAIL_RE.test(email) ? email : null;
  }

  private acceptanceLimit(value: unknown): number | null | undefined {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) return undefined;

    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 1 && limit <= MAX_ACCEPTANCE_LIMIT
      ? limit
      : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }
}

export default new InviteInputParser();
