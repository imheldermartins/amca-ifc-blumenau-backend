import type { Schema } from "@/db/schemas/index";

export interface SchedulePinTargetRow {
  source_page_id: NonEmptyString;
  source_title: string | null;
}

export interface PinnedSchedulePageRow extends Schema.PinnedSchedulePage {
  page_title: string | null;
  source_page_id: NonEmptyString;
  source_title: string | null;
  date_value_data: string | null;
}

export interface SchedulePropertyRow {
  page_id: NonEmptyString;
  column_id: NonEmptyString;
  column_name: string | null;
  column_type: Schema.ColumnType;
  column_data: string | null;
  value_data: string;
}
