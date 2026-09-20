export type AccessFailureReason = "validation" | "forbidden" | "conflict" | "server_error";

export type AccessResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; reason: AccessFailureReason; message: string };
