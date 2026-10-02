import { describe, expect, it, vi } from "vitest";

import { ScheduleController } from "@/controllers/schedule-controller";
import type { PageAccessController } from "@/controllers/page-access-controller";
import type {
  CreateSchedulePinRequestInput,
  SchedulePinRequestStore,
} from "@/repositories/schedule-pin-request-repository";
import type { ScheduleStore, UpsertSchedulePinInput } from "@/repositories/schedule-repository";
import type {
  PinnedSchedulePageRow,
  SchedulePinRequestRow,
  SchedulePropertyRow,
} from "@/repositories/types/schedule-repository.types";

const WORKSPACE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const OTHER_USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const PAGE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const HIDDEN_PAGE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const SOURCE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const DATE_COLUMN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const COLOR_COLUMN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const OPTION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
const PIN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB4";
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB5";

function pinRow(pageId = PAGE_ID): PinnedSchedulePageRow {
  return {
    id: PIN_ID,
    created_at: "2026-09-28 12:00:00",
    updated_at: "2026-09-28 12:00:00",
    workspace_id: WORKSPACE_ID,
    page_id: pageId as PinnedSchedulePageRow["page_id"],
    pinned_by_user_id: USER_ID,
    date_column_id: DATE_COLUMN_ID,
    color_column_id: null,
    page_title: "Entrega" as PinnedSchedulePageRow["page_title"],
    source_page_id: SOURCE_ID,
    source_title: "Projetos" as PinnedSchedulePageRow["source_title"],
    date_value_data: JSON.stringify({ value: "2026-09-27@2026-09-29" }),
  };
}

function propertyRows(pageId = PAGE_ID): SchedulePropertyRow[] {
  return [{
    page_id: pageId as SchedulePropertyRow["page_id"],
    column_id: COLOR_COLUMN_ID,
    column_name: "Status",
    column_type: "select",
    column_data: JSON.stringify({
      options: [{ id: OPTION_ID, value: "Em andamento", color: "blue" }],
    }),
    value_data: JSON.stringify({ value: OPTION_ID }),
  }];
}

function requestRow(status: SchedulePinRequestRow["status"] = "pending"): SchedulePinRequestRow {
  return {
    id: REQUEST_ID,
    created_at: "2026-09-28 12:00:00",
    updated_at: "2026-09-28 12:00:00",
    workspace_id: WORKSPACE_ID,
    page_id: PAGE_ID,
    requested_by_user_id: USER_ID,
    recipient_user_id: OTHER_USER_ID,
    date_column_id: DATE_COLUMN_ID,
    color_column_id: COLOR_COLUMN_ID,
    status,
    decided_at: null,
    page_title: "Entrega",
    requester_name: "Pessoa solicitante",
    requester_email: "requester@example.test",
    recipient_name: "Pessoa destinatária",
    recipient_email: "recipient@example.test",
  };
}

function setup(rows = [pinRow()], properties = propertyRows()) {
  const captured: UpsertSchedulePinInput[] = [];
  const capturedRequests: CreateSchedulePinRequestInput[] = [];
  const store = {
    list: vi.fn().mockResolvedValue(rows),
    listProperties: vi.fn().mockResolvedValue(properties),
    listReadablePageIds: vi.fn().mockResolvedValue(new Set(rows.filter((row) => row.page_id !== HIDDEN_PAGE_ID).map((row) => row.page_id))),
    resolvePinTarget: vi.fn().mockResolvedValue({
      source_page_id: SOURCE_ID,
      source_title: "Projetos",
    }),
    upsert: vi.fn().mockImplementation((input: UpsertSchedulePinInput) => {
      captured.push(input);
      return Promise.resolve(pinRow());
    }),
    delete: vi.fn().mockResolvedValue(true),
  };
  const access = {
    canAccessPage: vi.fn().mockImplementation(
      async (_userId: string, pageId: string) => pageId !== HIDDEN_PAGE_ID,
    ),
  };
  const requests = {
    listEligibleRecipients: vi.fn().mockResolvedValue([{
      id: OTHER_USER_ID,
      name: "Pessoa destinatária",
      email: "recipient@example.test",
    }]),
    requestContext: vi.fn().mockResolvedValue({
      page_title: "Entrega",
      actor_name: "Pessoa solicitante",
      actor_email: "requester@example.test",
    }),
    create: vi.fn().mockImplementation((input: CreateSchedulePinRequestInput) => {
      capturedRequests.push(input);
      return Promise.resolve(true);
    }),
    findForRecipient: vi.fn().mockResolvedValue(requestRow()),
    decide: vi.fn().mockResolvedValue(true),
  };
  return {
    controller: new ScheduleController(
      store as unknown as ScheduleStore,
      access as unknown as PageAccessController,
      requests as unknown as SchedulePinRequestStore,
    ),
    store,
    requests,
    captured,
    capturedRequests,
  };
}

describe("ScheduleController", () => {
  it("projeta range inclusivo como fim exclusivo e usa a primeira select como cor", async () => {
    const { controller } = setup();
    const result = await controller.list(WORKSPACE_ID, USER_ID);

    expect(result).toMatchObject({
      ok: true,
      data: [{
        pageId: PAGE_ID,
        sourcePageId: SOURCE_ID,
        start: "2026-09-27",
        end: "2026-09-30",
        allDay: true,
        color: "blue",
        colorColumnId: COLOR_COLUMN_ID,
        properties: [{ id: COLOR_COLUMN_ID, value: "Em andamento" }],
      }],
    });
  });

  it("trata ISO à meia-noite como dia inteiro e preserva fim exclusivo em ISO", async () => {
    const row = { ...pinRow(), date_value_data: JSON.stringify({ value: "2026-09-27T00:00:00.000Z@2026-09-29T00:00:00.000Z" }) };
    const { controller } = setup([row]);
    const result = await controller.list(WORKSPACE_ID, USER_ID);
    expect(result).toMatchObject({ ok: true, data: [{
      start: "2026-09-27T00:00:00.000Z",
      end: "2026-09-30T00:00:00.000Z",
      allDay: true,
    }] });
  });

  it("não troca uma coluna de cor explícita sem valor por outra select", async () => {
    const { controller } = setup([{ ...pinRow(), color_column_id: COLOR_COLUMN_ID }], []);
    const result = await controller.list(WORKSPACE_ID, USER_ID);
    expect(result).toMatchObject({ ok: true, data: [{ color: "purple", colorColumnId: COLOR_COLUMN_ID }] });
  });

  it("não projeta páginas que o usuário deixou de poder ler", async () => {
    const { controller } = setup(
      [pinRow(), { ...pinRow(HIDDEN_PAGE_ID), id: "01ARZ3NDEKTSV4RRFFQ69G5FB5" }],
      [...propertyRows(), ...propertyRows(HIDDEN_PAGE_ID)],
    );
    const result = await controller.list(WORKSPACE_ID, USER_ID);
    expect(result.ok && result.data.map((item) => item.pageId)).toEqual([PAGE_ID]);
  });

  it("sempre grava o usuário autenticado e ignora um pinned_by enviado no body", async () => {
    const { controller, captured } = setup();
    const result = await controller.pin(
      WORKSPACE_ID,
      PAGE_ID,
      USER_ID,
      {
        dateColumnId: DATE_COLUMN_ID,
        colorColumnId: COLOR_COLUMN_ID,
        pinned_by_user_id: OTHER_USER_ID,
      } as never,
    );

    expect(result.ok).toBe(true);
    expect(captured).toEqual([{
      workspaceId: WORKSPACE_ID,
      pageId: PAGE_ID,
      userId: USER_ID,
      dateColumnId: DATE_COLUMN_ID,
      colorColumnId: COLOR_COLUMN_ID,
    }]);
  });

  it("rejeita coluna ou vínculo incompatível antes de escrever", async () => {
    const { controller, store } = setup();
    store.resolvePinTarget.mockResolvedValueOnce(null);
    const result = await controller.pin(WORKSPACE_ID, PAGE_ID, USER_ID, {
      dateColumnId: DATE_COLUMN_ID,
    });
    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it("desafixa somente a relação do usuário e workspace atuais", async () => {
    const { controller, store } = setup();
    await expect(controller.unpin(WORKSPACE_ID, PAGE_ID, USER_ID)).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(store.delete).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID, PAGE_ID);
  });

  it("solicita o pin somente para destinatário elegível e deriva o ator do token", async () => {
    const { controller, capturedRequests } = setup();
    const result = await controller.requestPin(WORKSPACE_ID, PAGE_ID, USER_ID, {
      recipientUserId: OTHER_USER_ID,
      dateColumnId: DATE_COLUMN_ID,
      colorColumnId: COLOR_COLUMN_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "pending",
        emailQueued: true,
        recipient: { id: OTHER_USER_ID },
      },
    });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      pageId: PAGE_ID,
      requestedByUserId: USER_ID,
      recipientUserId: OTHER_USER_ID,
      dateColumnId: DATE_COLUMN_ID,
      colorColumnId: COLOR_COLUMN_ID,
      notificationData: {
        status: "pending",
        pageId: PAGE_ID,
        pageTitle: "Entrega",
        requesterName: "Pessoa solicitante",
      },
    });
    expect(capturedRequests[0]?.email.to.email).toBe("recipient@example.test");
  });

  it("não cria solicitação para usuário sem acesso atual à página", async () => {
    const { controller, requests } = setup();
    requests.listEligibleRecipients.mockResolvedValueOnce([]);

    const result = await controller.requestPin(WORKSPACE_ID, PAGE_ID, USER_ID, {
      recipientUserId: OTHER_USER_ID,
      dateColumnId: DATE_COLUMN_ID,
    });

    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(requests.create).not.toHaveBeenCalled();
  });

  it("aceita uma solicitação pendente e devolve o item já projetado na agenda", async () => {
    const { controller, requests } = setup();
    const result = await controller.decidePinRequest(
      WORKSPACE_ID,
      REQUEST_ID,
      OTHER_USER_ID,
      { decision: "accepted" },
    );

    expect(requests.decide).toHaveBeenCalledWith(
      expect.objectContaining({ id: REQUEST_ID }),
      OTHER_USER_ID,
      "accepted",
    );
    expect(result).toMatchObject({
      ok: true,
      data: { requestId: REQUEST_ID, status: "accepted", pinnedPage: { pageId: PAGE_ID } },
    });
  });

  it("impede resposta repetida sem executar outra mutation", async () => {
    const { controller, requests } = setup();
    requests.findForRecipient.mockResolvedValueOnce(requestRow("accepted"));

    const result = await controller.decidePinRequest(
      WORKSPACE_ID,
      REQUEST_ID,
      OTHER_USER_ID,
      { decision: "declined" },
    );

    expect(result).toMatchObject({ ok: false, reason: "conflict" });
    expect(requests.decide).not.toHaveBeenCalled();
  });
});
