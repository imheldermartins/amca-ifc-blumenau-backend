import { Schema } from "@/db/schemas/index";
import type { Input } from "@/db/schemas/inputs";
import pageAccessController, { PageAccessController } from "@/controllers/page-access-controller";
import type {
  PinnedSchedulePageDto,
  SchedulePinDecisionDto,
  SchedulePinRequestDto,
  SchedulePropertyDto,
  ScheduleRecipientDto,
} from "@/controllers/types/schedule-controller.types";
import type { ServiceResult } from "@/controllers/types/service-result.types";
import scheduleStore, { ScheduleStore } from "@/repositories/schedule-repository";
import schedulePinRequestStore, { SchedulePinRequestStore } from "@/repositories/schedule-pin-request-repository";
import type {
  PinnedSchedulePageRow,
  SchedulePropertyRow,
} from "@/repositories/types/schedule-repository.types";
import { VALUE_CODECS } from "@/services/value-codec";
import { schedulePinRequestMail } from '@/services/notifications/schedule-notification-mail';
import { projectScheduleInterval } from '@/services/schedule/schedule-date';
import { isUlid } from "@/utils/ulid";
import { ulid } from 'ulid';

const COLORS = new Set<Schema.ColorOptions>(Schema.COLOR_OPTIONS);

interface SelectOptionData {
  id: string;
  value: string;
  color?: Schema.ColorOptions;
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

/** Regras de pin e projeção do schedule; não conhece Express. */
export class ScheduleController {
  public constructor(
    private readonly store: ScheduleStore = scheduleStore,
    private readonly access: PageAccessController = pageAccessController,
    private readonly requests: SchedulePinRequestStore = schedulePinRequestStore,
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

  public async recipients(
    workspaceId: string,
    pageId: string,
    userId: string,
  ): Promise<ServiceResult<ScheduleRecipientDto[]>> {
    if (!isUlid(workspaceId) || !isUlid(pageId) || !isUlid(userId)) {
      return { ok: false, reason: 'validation', message: 'Página ou workspace inválida' };
    }
    if (!await this.access.canAccessPage(userId, pageId)) {
      return { ok: false, reason: 'not_found', message: '"Page" não encontrado' };
    }
    try {
      const recipients = await this.requests.listEligibleRecipients(
        workspaceId as NonEmptyString,
        pageId as NonEmptyString,
        userId as NonEmptyString,
      );
      return { ok: true, data: recipients };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao carregar destinatários' };
    }
  }

  public async requestPin(
    workspaceId: string,
    pageId: string,
    userId: string,
    input: Input.RequestSchedulePin,
  ): Promise<ServiceResult<SchedulePinRequestDto>> {
    const recipientUserId = input.recipientUserId;
    const dateColumnId = input.dateColumnId;
    const colorColumnId = input.colorColumnId ?? null;
    if (
      !isUlid(workspaceId) || !isUlid(pageId) || !isUlid(userId)
      || !isUlid(recipientUserId) || !isUlid(dateColumnId)
      || (colorColumnId !== null && !isUlid(colorColumnId))
    ) {
      return { ok: false, reason: 'validation', message: 'Solicitação de agenda inválida' };
    }
    if (recipientUserId === userId) {
      return { ok: false, reason: 'validation', message: 'Fixe a página diretamente na sua agenda' };
    }
    if (!await this.access.canAccessPage(userId, pageId)) {
      return { ok: false, reason: 'not_found', message: '"Page" não encontrado' };
    }
    try {
      const [target, recipients, context] = await Promise.all([
        this.store.resolvePinTarget(
          workspaceId as NonEmptyString,
          pageId as NonEmptyString,
          dateColumnId as NonEmptyString,
          colorColumnId as NonEmptyString | null,
        ),
        this.requests.listEligibleRecipients(
          workspaceId as NonEmptyString,
          pageId as NonEmptyString,
          userId as NonEmptyString,
        ),
        this.requests.requestContext(pageId as NonEmptyString, userId as NonEmptyString),
      ]);
      const recipient = recipients.find((candidate) => candidate.id === recipientUserId);
      if (!target || !recipient || !context) {
        return {
          ok: false,
          reason: 'forbidden',
          message: 'O destinatário não pode visualizar esta página nesta workspace',
        };
      }
      const requestId = ulid() as NonEmptyString;
      const requesterName = context.actor_name || context.actor_email;
      const pageTitle = context.page_title ?? 'Sem título';
      const recipientAddress = {
        name: recipient.name || recipient.email,
        email: recipient.email,
      };
      const created = await this.requests.create({
        requestId,
        notificationId: ulid() as NonEmptyString,
        deliveryId: ulid() as NonEmptyString,
        workspaceId: workspaceId as NonEmptyString,
        pageId: pageId as NonEmptyString,
        requestedByUserId: userId as NonEmptyString,
        recipientUserId: recipientUserId as NonEmptyString,
        dateColumnId: dateColumnId as NonEmptyString,
        colorColumnId: colorColumnId as NonEmptyString | null,
        notificationData: {
          status: 'pending',
          pageId,
          pageTitle,
          dateColumnId,
          colorColumnId,
          requesterName,
        },
        email: {
          to: recipientAddress,
          ...schedulePinRequestMail({
            recipient: recipientAddress,
            requesterName,
            pageTitle,
          }),
        },
      });
      return created
        ? { ok: true, data: { id: requestId, status: 'pending', recipient, emailQueued: true } }
        : {
            ok: false,
            reason: 'conflict',
            message: 'Já existe uma solicitação pendente para esta pessoa e página',
          };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao solicitar fixação' };
    }
  }

  public async decidePinRequest(
    workspaceId: string,
    requestId: string,
    userId: string,
    input: Input.DecideSchedulePinRequest,
  ): Promise<ServiceResult<SchedulePinDecisionDto>> {
    const decision = input.decision;
    if (
      !isUlid(workspaceId) || !isUlid(requestId) || !isUlid(userId)
      || (decision !== 'accepted' && decision !== 'declined')
    ) {
      return { ok: false, reason: 'validation', message: 'Decisão inválida' };
    }
    try {
      const request = await this.requests.findForRecipient(
        workspaceId as NonEmptyString,
        requestId as NonEmptyString,
        userId as NonEmptyString,
      );
      if (!request) {
        return { ok: false, reason: 'not_found', message: 'Solicitação não encontrada' };
      }
      if (request.status !== 'pending') {
        return { ok: false, reason: 'conflict', message: 'Esta solicitação já foi respondida' };
      }
      const saved = await this.requests.decide(request, userId as NonEmptyString, decision);
      if (!saved) {
        return {
          ok: false,
          reason: 'forbidden',
          message: 'A página não está mais disponível para esta agenda',
        };
      }
      let pinnedPage: PinnedSchedulePageDto | null = null;
      if (decision === 'accepted') {
        const listed = await this.list(workspaceId, userId);
        if (listed.ok) {
          pinnedPage = listed.data.find((candidate) => candidate.pageId === request.page_id) ?? null;
        }
      }
      return { ok: true, data: { requestId, status: decision, pinnedPage } };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao responder solicitação' };
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
    const projectedInterval = projectScheduleInterval(rawDate);
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
