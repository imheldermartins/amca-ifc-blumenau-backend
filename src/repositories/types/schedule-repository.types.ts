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

export interface ScheduleRecipientRow {
  id: NonEmptyString;
  name: string | null;
  email: string;
}

export interface ScheduleRequestContextRow {
  page_title: string | null;
  actor_name: string | null;
  actor_email: string;
}

export interface SchedulePinRequestRow extends Schema.SchedulePinRequest {
  page_title: string | null;
  requester_name: string | null;
  requester_email: string;
  recipient_name: string | null;
  recipient_email: string;
}

export interface ScheduleReminderCandidateRow {
  pin_id: NonEmptyString;
  pin_created_at: string;
  workspace_id: NonEmptyString;
  page_id: NonEmptyString;
  user_id: NonEmptyString;
  user_name: string | null;
  user_email: string;
  page_title: string | null;
  date_value_data: string;
}
