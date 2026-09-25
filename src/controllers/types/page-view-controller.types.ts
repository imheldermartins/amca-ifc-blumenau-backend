import type {
  ServiceFailure,
  ServiceResult,
} from "@/controllers/types/service-result.types";
import type { JsonRecord } from "@/services/types/json.types";

export type { JsonRecord } from "@/services/types/json.types";

export interface PageViewCreateResult {
  viewId: string;
  view: JsonRecord;
  data: JsonRecord;
}

export interface PageViewDeleteResult {
  viewId: string;
  data: JsonRecord;
}

export interface PageViewOrderResult {
  viewIds: string[];
  data: JsonRecord;
  changed: boolean;
}

export type PageViewFailure = ServiceFailure;
export type PageViewResult<T> = ServiceResult<T>;
