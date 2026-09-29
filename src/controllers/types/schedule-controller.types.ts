import type { Schema } from "@/db/schemas/index";

export interface SchedulePropertyDto {
  id: string;
  label: string;
  type: Schema.ColumnType;
  value: unknown;
  color?: Schema.ColorOptions;
}

export interface PinnedSchedulePageDto {
  id: string;
  workspaceId: string;
  pageId: string;
  sourcePageId: string;
  sourceTitle: string | null;
  title: string;
  dateColumnId: string;
  colorColumnId: string | null;
  start: string;
  end?: string;
  allDay: boolean;
  color: Schema.ColorOptions;
  properties: SchedulePropertyDto[];
  pinnedAt: string;
}
