import type { Response } from "express";
import type {
  AccessFailureReason,
  AccessResult,
} from "@/controllers/types/access-controller.types";
import { StatusCode } from "@/services/http/status-code";

const FAILURE_STATUS = {
  validation: StatusCode.BAD_REQUEST,
  forbidden: StatusCode.FORBIDDEN,
  conflict: StatusCode.CONFLICT,
  server_error: StatusCode.INTERNAL_SERVER_ERROR,
} satisfies Record<AccessFailureReason, number>;

/** Utilitário puro: converte o Result de acesso no contrato HTTP. */
export function sendAccessResult(
  res: Response,
  result: AccessResult,
  successStatus: number = StatusCode.OK,
): Response {
  if (result.ok) {
    return res.status(successStatus).json(result.data);
  }

  return res.status(FAILURE_STATUS[result.reason]).json({ message: result.message });
}
