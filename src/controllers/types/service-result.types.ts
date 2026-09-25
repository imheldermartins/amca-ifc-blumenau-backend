export type ServiceFailureReason =
  | "not_found"
  | "validation"
  | "forbidden"
  | "conflict"
  | "server_error";

export interface ServiceFailure {
  ok: false;
  reason: ServiceFailureReason;
  message: string;
}

export type ServiceResult<T> = { ok: true; data: T } | ServiceFailure;
