import type { Response } from "express";
import type { ServiceFailure } from "@/controllers/types/service-result.types";
import { StatusCode } from "@/services/http/status-code";

const FAILURE_STATUS = {
  not_found: StatusCode.NOT_FOUND,
  validation: StatusCode.BAD_REQUEST,
  forbidden: StatusCode.FORBIDDEN,
  conflict: StatusCode.CONFLICT,
  server_error: StatusCode.INTERNAL_SERVER_ERROR,
} satisfies Record<ServiceFailure["reason"], number>;

/** Utilitário puro que traduz falha de domínio Page para HTTP. */
export function sendPageFailure(response: Response, failure: ServiceFailure): Response {
  return response.status(FAILURE_STATUS[failure.reason]).json({ message: failure.message });
}
