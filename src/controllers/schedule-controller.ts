import { Schema } from "@/db/schemas/index";
import type { Input } from "@/db/schemas/inputs";
import pageAccessController, { PageAccessController } from "@/controllers/page-access-controller";
import type {
  PinnedSchedulePageDto,
  SchedulePropertyDto,
} from "@/controllers/types/schedule-controller.types";
import type { ServiceResult } from "@/controllers/types/service-result.types";
import scheduleStore, { ScheduleStore } from "@/repositories/schedule-repository";
import type {
  PinnedSchedulePageRow,
  SchedulePropertyRow,
} from "@/repositories/types/schedule-repository.types";
import { VALUE_CODECS } from "@/services/value-codec";
import { isUlid } from "@/utils/ulid";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT_ISO = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;
const COLORS = new Set<Schema.ColorOptions>(Schema.COLOR_OPTIONS);

interface SelectOptionData {
  id: string;
  value: string;
  color?: Schema.ColorOptions;
}

function addUtcDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function parseColumnData(raw: string | null): Schema.PageColumnData {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Schema.PageColumnData
      : {};
  } catch {
    return {};
  }
}

function selectOption(row: SchedulePropertyRow, value: unknown): SelectOptionData | undefined {
  if (typeof value !== "string") return undefined;
  const options = parseColumnData(row.column_data).options ?? [];
  const option = options.find((candidate) => candidate.id === value);
  if (!option) return undefined;
  return {
    id: option.id,
    value: option.value,
    ...(option.color && COLORS.has(option.color) && { color: option.color }),
  };
}

function decodeProperty(row: SchedulePropertyRow): SchedulePropertyDto | null {
  try {
    const value = VALUE_CODECS[row.column_type].decode(row.value_data);
    const option = row.column_type === "select" ? selectOption(row, value) : undefined;
    if (value === undefined || value === null || value === "") return null;
    if (row.column_type === "select" && !option) return null;
    return {
      id: row.column_id,
      label: row.column_name ?? "Sem nome",
      type: row.column_type,
      value: option?.value ?? value,
      ...(option?.color && { color: option.color }),
    };
  } catch {
    return null;
  }
}

function interval(raw: string): Pick<PinnedSchedulePageDto, "start" | "end" | "allDay"> | null {
  const parts = raw.includes("@") ? raw.split("@") : [raw];
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return null;
  const start = parts[0];
  const inclusiveEnd = parts[1];
  const isAllDayPart = (value: string) => DATE_ONLY.test(value) || MIDNIGHT_ISO.test(value);
  const allDay = isAllDayPart(start) && (!inclusiveEnd || isAllDayPart(inclusiveEnd));
  const inclusive = inclusiveEnd ?? start;
  const end = allDay
    ? DATE_ONLY.test(inclusive)
      ? addUtcDay(inclusive)
      : `${addUtcDay(inclusive.slice(0, 10))}T00:00:00.000Z`
    : inclusiveEnd;
  if (end && end < start) return null;
  return { start, ...(end && { end }), allDay };
}

/** Regras de pin e projeção do schedule; não conhece Express. */
export class ScheduleController {
  public constructor(
    private readonly store: ScheduleStore = scheduleStore,
    private readonly access: PageAccessController = pageAccessController,
  ) {}

  public async list(
    workspaceId: string,
    userId: string,
  ): Promise<ServiceResult<PinnedSchedulePageDto[]>> {
    if (!isUlid(workspaceId) || !isUlid(userId)) {
      return { ok: false, reason: "validation", message: "Agenda inválida" };
    }
    try {
      const pins = await this.store.list(workspaceId, userId);
      const [propertyRows, visibleIds] = await Promise.all([
        this.store.listProperties(workspaceId, userId),
        this.store.listReadablePageIds(userId, pins.map((pin) => pin.page_id)),
      ]);
      const properties = new Map<string, SchedulePropertyRow[]>();
      for (const row of propertyRows) {
        if (!visibleIds.has(row.page_id)) continue;
        const group = properties.get(row.page_id) ?? [];
        group.push(row);
        properties.set(row.page_id, group);
      }
      return {
        ok: true,
        data: pins.flatMap((pin) => {
          if (!visibleIds.has(pin.page_id)) return [];
          const projected = this.project(pin, properties.get(pin.page_id) ?? []);
          return projected ? [projected] : [];
        }),
      };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro ao carregar agenda" };
    }
  }

  public async pin(
    workspaceId: string,
    pageId: string,
    userId: string,
    input: Input.PinSchedulePage,
  ): Promise<ServiceResult<PinnedSchedulePageDto>> {
    const dateColumnId = input.dateColumnId;
    const colorColumnId = input.colorColumnId ?? null;
    if (
      !isUlid(workspaceId) ||
      !isUlid(pageId) ||
      !isUlid(userId) ||
      !isUlid(dateColumnId) ||
      (colorColumnId !== null && !isUlid(colorColumnId))
    ) {
      return { ok: false, reason: "validation", message: "Configuração da agenda inválida" };
    }
    if (!await this.access.canAccessPage(userId, pageId)) {
      return { ok: false, reason: "not_found", message: '"Page" não encontrado' };
    }
    try {
      const target = await this.store.resolvePinTarget(
        workspaceId,
        pageId,
        dateColumnId,
        colorColumnId,
      );
      if (!target) {
        return {
          ok: false,
          reason: "validation",
          message: "Página ou propriedades incompatíveis com este workspace",
        };
      }
      const saved = await this.store.upsert({
        workspaceId,
        pageId,
        userId,
        dateColumnId,
        colorColumnId,
      });
      if (!saved) {
        return { ok: false, reason: "server_error", message: "Erro ao fixar página" };
      }
      const listed = await this.list(workspaceId, userId);
      if (!listed.ok) return listed;
      const item = listed.data.find((candidate) => candidate.pageId === pageId);
      return item
        ? { ok: true, data: item }
        : { ok: false, reason: "validation", message: "A página não possui uma data válida" };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro ao fixar página" };
    }
  }

  public async unpin(
    workspaceId: string,
    pageId: string,
    userId: string,
  ): Promise<ServiceResult<null>> {
    if (!isUlid(workspaceId) || !isUlid(pageId) || !isUlid(userId)) {
      return { ok: false, reason: "validation", message: "Agenda inválida" };
    }
    try {
      await this.store.delete(workspaceId, userId, pageId);
      return { ok: true, data: null };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: "server_error", message: "Erro ao desafixar página" };
    }
  }

  private project(
    pin: PinnedSchedulePageRow,
    rows: SchedulePropertyRow[],
  ): PinnedSchedulePageDto | null {
    if (!pin.date_value_data) return null;
    let rawDate: unknown;
    try {
      rawDate = VALUE_CODECS.date.decode(pin.date_value_data);
    } catch {
      return null;
    }
    if (typeof rawDate !== "string") return null;
    const projectedInterval = interval(rawDate);
    if (!projectedInterval) return null;

    const properties = rows
      .filter((row) => row.column_id !== pin.date_column_id)
      .map(decodeProperty)
      .filter((property): property is SchedulePropertyDto => property !== null);
    const colorProperty = pin.color_column_id
      ? properties.find((property) => property.id === pin.color_column_id && property.type === "select")
      : properties.find((property) => property.type === "select");

    return {
      id: pin.id,
      workspaceId: pin.workspace_id,
      pageId: pin.page_id,
      sourcePageId: pin.source_page_id,
      sourceTitle: pin.source_title,
      title: pin.page_title ?? "Sem título",
      dateColumnId: pin.date_column_id,
      colorColumnId: pin.color_column_id ?? colorProperty?.id ?? null,
      ...projectedInterval,
      color: colorProperty?.color ?? "purple",
      properties,
      pinnedAt: pin.created_at,
    };
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

export default new ScheduleController();
