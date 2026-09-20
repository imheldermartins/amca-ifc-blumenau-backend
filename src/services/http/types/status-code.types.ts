import type { StatusCode } from "@/services/http/status-code";

export type HttpStatusCode = (typeof StatusCode)[keyof typeof StatusCode];
