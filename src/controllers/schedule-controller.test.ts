import { describe, expect, it, vi } from "vitest";

import { ScheduleController } from "@/controllers/schedule-controller";
import type { PageAccessController } from "@/controllers/page-access-controller";
import type { ScheduleStore, UpsertSchedulePinInput } from "@/repositories/schedule-repository";
import type {
  PinnedSchedulePageRow,
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

function setup(rows = [pinRow()], properties = propertyRows()) {
  const captured: UpsertSchedulePinInput[] = [];
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
  return {
    controller: new ScheduleController(
      store as unknown as ScheduleStore,
      access as unknown as PageAccessController,
    ),
    store,
    captured,
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
});
