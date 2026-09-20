export type OrganizationMutationFailureReason =
  | "validation"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "server_error";

export type OrganizationMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: OrganizationMutationFailureReason; message: string };
