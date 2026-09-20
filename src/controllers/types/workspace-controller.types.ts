export type WorkspaceMutationFailureReason =
  | "validation"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "server_error";

export type WorkspaceMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: WorkspaceMutationFailureReason; message: string };
