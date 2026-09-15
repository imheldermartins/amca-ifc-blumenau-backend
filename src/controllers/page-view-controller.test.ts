import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Schema } from "@models/schemas/index";

const mocks = vi.hoisted(() => ({
  pages: {
    find: vi.fn(),
  },
  columns: {
    findAll: vi.fn(),
  },
  pageJson: {
    commitFilterKeyReconcile: vi.fn(),
    insertPageViewJson: vi.fn(),
    updatePageJsonPaths: vi.fn(),
    updatePageViewFiltersJson: vi.fn(),
  },
}));

vi.mock("@models/index", () => ({
  default: {
    pages: mocks.pages,
    pageColumns: mocks.columns,
  },
}));

vi.mock("@/core/db/page-json", () => ({
  commitFilterKeyReconcile: mocks.pageJson.commitFilterKeyReconcile,
  insertPageViewJson: mocks.pageJson.insertPageViewJson,
  updatePageJsonPaths: mocks.pageJson.updatePageJsonPaths,
  updatePageViewFiltersJson: mocks.pageJson.updatePageViewFiltersJson,
}));

import pageViewController from "./page-view-controller.js";

const PAGE_ID = "01KXVZ00000000000000000001";
const VIEW_ID = "01KXVZ00000000000000000002";
const OTHER_VIEW_ID = "01KXVZ00000000000000000003";
const COLUMN_ID = "01KXVZ00000000000000000004";
const OWNER_ID = "01KXVZ00000000000000000005";
const NOW = "2026-09-01T12:34:56.789Z";

const entityDates = {
  created_at: new Date("2026-08-01T00:00:00.000Z"),
  updated_at: new Date("2026-08-02T00:00:00.000Z"),
  deleted_at: null,
};

function page(data: Record<string, unknown>): Schema.Page {
  return {
    id: PAGE_ID,
    owner_id: OWNER_ID,
    title: "Base",
    data,
    ...entityDates,
  };
}

function column(data: Schema.PageColumnData = {}): Schema.PageColumn {
  return {
    id: COLUMN_ID,
    parent_id: PAGE_ID,
    name: "Área",
    type: "text",
    data,
    ...entityDates,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.columns.findAll.mockResolvedValue([]);
  mocks.pageJson.updatePageViewFiltersJson.mockResolvedValue(true);
  mocks.pageJson.updatePageJsonPaths.mockResolvedValue(true);
  mocks.pageJson.commitFilterKeyReconcile.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PageViewController", () => {
  it.each(["table", "grid", "board", "calendar", "timeline", "graph"])(
    "cria uma nova view %s sem modificar as outras",
    async (kind) => {
      const existing = { view: "table", name: "Principal", urlKey: { key: "principal", aliases: [] } };
      const current = page({ [OTHER_VIEW_ID]: existing });
      let persisted = current;
      mocks.pages.find.mockImplementation(async () => persisted);
      mocks.pageJson.insertPageViewJson.mockImplementation(async (_pageId, viewId, view) => {
        persisted = page({ ...current.data, [viewId]: view });
        return true;
      });

      const result = await pageViewController.createView(PAGE_ID, {
        type: kind,
        name: "Nova view",
        title: { key: "title", column_name: "Docente" },
      });

      expect(result).toMatchObject({
        ok: true,
        data: { view: { view: kind, name: "Nova view", orderedHeaderCols: [] } },
      });
      expect(mocks.pageJson.insertPageViewJson).toHaveBeenCalledWith(
        PAGE_ID,
        expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        expect.objectContaining({
          filters: { version: 2, updatedAt: null, clauses: [], groupBy: [], passthrough: [] },
          title: expect.objectContaining({ key: "title", column_name: "Docente" }),
        }),
      );
      expect(result.ok && result.data.data[OTHER_VIEW_ID]).toEqual(existing);
    },
  );

  it("usa table quando type não é informado", async () => {
    const current = page({});
    let persisted = current;
    mocks.pages.find.mockImplementation(async () => persisted);
    mocks.pageJson.insertPageViewJson.mockImplementation(async (_pageId, viewId, view) => {
      persisted = page({ [viewId]: view });
      return true;
    });

    const result = await pageViewController.createView(PAGE_ID, { name: "Nova tabela" });

    expect(result).toMatchObject({
      ok: true,
      data: { view: { view: "table", name: "Nova tabela" } },
    });
  });

  it("aceita type na query e recusa tipos conflitantes", async () => {
    const current = page({});
    let persisted = current;
    mocks.pages.find.mockImplementation(async () => persisted);
    mocks.pageJson.insertPageViewJson.mockImplementation(async (_pageId, viewId, view) => {
      persisted = page({ [viewId]: view });
      return true;
    });

    const result = await pageViewController.createView(PAGE_ID, { name: "Quadros" }, "board");
    expect(result).toMatchObject({ ok: true, data: { view: { view: "board" } } });
    expect(await pageViewController.createView(PAGE_ID, { name: "Conflito", type: "table", view: "board" }))
      .toMatchObject({ ok: false, reason: "validation" });
  });

  it("recusa campos e tipos inválidos antes de consultar a página", async () => {
    expect(await pageViewController.createView(PAGE_ID, { type: "map", name: "Mapa" }))
      .toMatchObject({ ok: false, reason: "validation" });
    expect(await pageViewController.createView(PAGE_ID, { view: "table", name: "", filters: {} }))
      .toMatchObject({ ok: false, reason: "validation" });
    expect(mocks.pages.find).not.toHaveBeenCalled();
  });

  it("duplica filtros, ordem e larguras com id e chave pública próprios", async () => {
    const source = {
      view: "board", name: "Quadros", urlKey: { key: "quadros", aliases: [] },
      filters: { version: 2, updatedAt: NOW, clauses: [], groupBy: ["page_title"], passthrough: [] },
      title: { key: "title", column_name: "Título", publicKey: { key: "titulo", aliases: [] } },
      orderedHeaderCols: [COLUMN_ID], columnWidths: { [COLUMN_ID]: 300 }, orderedRows: [OTHER_VIEW_ID],
    };
    let persisted = page({ [VIEW_ID]: source });
    mocks.pages.find.mockImplementation(async () => persisted);
    mocks.pageJson.insertPageViewJson.mockImplementation(async (_pageId, viewId, view) => {
      persisted = page({ ...persisted.data, [viewId]: view });
      return true;
    });
    const result = await pageViewController.duplicateView(PAGE_ID, VIEW_ID);
    expect(result).toMatchObject({ ok: true, data: { view: {
      view: "board", name: "Quadros (cópia)", filters: source.filters,
      title: source.title, orderedHeaderCols: [COLUMN_ID], orderedRows: [OTHER_VIEW_ID],
      columnWidths: { [COLUMN_ID]: 300 },
    } } });
    expect(result.ok && result.data.viewId).not.toBe(VIEW_ID);
    expect(result.ok && (result.data.view.urlKey as { key: string }).key).not.toBe("quadros");
    expect(mocks.pageJson.insertPageViewJson).toHaveBeenCalledWith(PAGE_ID, expect.any(String), expect.any(Object), VIEW_ID);
    expect(result.ok && result.data.data[VIEW_ID]).toEqual(source);
  });

  it("marca a view como excluída sem alterar as outras e recusa novas escritas nela", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const source = { view: "table", name: "Tabela", filters: { version: 2, updatedAt: null, clauses: [], groupBy: [], passthrough: [] } };
    const other = { view: "board", name: "Quadros" };
    let persisted = page({ [VIEW_ID]: source, [OTHER_VIEW_ID]: other });
    mocks.pages.find.mockImplementation(async () => persisted);
    mocks.pageJson.updatePageJsonPaths.mockImplementation(async (_pageId, patches) => {
      persisted = page({ ...persisted.data, [VIEW_ID]: { ...source, deletedAt: patches[0].value } });
      return true;
    });
    const result = await pageViewController.deleteView(PAGE_ID, VIEW_ID);
    expect(result).toMatchObject({ ok: true, data: { data: {
      [VIEW_ID]: { ...source, deletedAt: NOW }, [OTHER_VIEW_ID]: other,
    } } });
    expect(mocks.pageJson.updatePageJsonPaths).toHaveBeenCalledWith(PAGE_ID, [{ path: [VIEW_ID, "deletedAt"], value: NOW }], VIEW_ID);
    expect(await pageViewController.deleteView(PAGE_ID, VIEW_ID)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await pageViewController.duplicateView(PAGE_ID, VIEW_ID)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await pageViewController.patchView(PAGE_ID, VIEW_ID, { name: "Novo" })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await pageViewController.updateFilters(PAGE_ID, VIEW_ID, { version: 2, clauses: [], groupBy: [], passthrough: [] }))
      .toMatchObject({ ok: false, reason: "not_found" });
  });

  it("persiste a ordem completa das views em um único patch protegido", async () => {
    const first = { view: "table", name: "Tabela", order: 0 };
    const second = { view: "graph", name: "Grafo", order: 1 };
    const currentData = { [VIEW_ID]: first, [OTHER_VIEW_ID]: second };
    let persisted = page(currentData);
    mocks.pages.find.mockImplementation(async () => persisted);
    mocks.pageJson.updatePageJsonPaths.mockImplementation(async (_pageId, patches) => {
      persisted = page({
        [VIEW_ID]: { ...first, order: patches.find((patch: { path: string[] }) => patch.path[0] === VIEW_ID)?.value },
        [OTHER_VIEW_ID]: { ...second, order: patches.find((patch: { path: string[] }) => patch.path[0] === OTHER_VIEW_ID)?.value },
      });
      return true;
    });

    const result = await pageViewController.reorderViews(PAGE_ID, {
      viewIds: [OTHER_VIEW_ID, VIEW_ID],
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        viewIds: [OTHER_VIEW_ID, VIEW_ID],
        changed: true,
        data: {
          [VIEW_ID]: { ...first, order: 1 },
          [OTHER_VIEW_ID]: { ...second, order: 0 },
        },
      },
    });
    expect(mocks.pages.find).toHaveBeenCalledTimes(1);
    expect(mocks.pageJson.updatePageJsonPaths).toHaveBeenCalledWith(
      PAGE_ID,
      [
        { path: [OTHER_VIEW_ID, "order"], value: 0 },
        { path: [VIEW_ID, "order"], value: 1 },
      ],
      [OTHER_VIEW_ID, VIEW_ID],
      currentData,
    );
  });

  it("recusa ordem parcial, duplicada ou baseada em catálogo desatualizado", async () => {
    mocks.pages.find.mockResolvedValue(page({
      [VIEW_ID]: { view: "table", name: "Tabela" },
      [OTHER_VIEW_ID]: { view: "graph", name: "Grafo" },
    }));

    expect(await pageViewController.reorderViews(PAGE_ID, { viewIds: [VIEW_ID] }))
      .toMatchObject({ ok: false, reason: "conflict" });
    expect(await pageViewController.reorderViews(PAGE_ID, { viewIds: [VIEW_ID, VIEW_ID] }))
      .toMatchObject({ ok: false, reason: "validation" });
    expect(await pageViewController.reorderViews(PAGE_ID, { viewIds: [VIEW_ID, COLUMN_ID] }))
      .toMatchObject({ ok: false, reason: "conflict" });
    expect(mocks.pageJson.updatePageJsonPaths).not.toHaveBeenCalled();
  });

  it("carimba filtros no servidor e altera somente o path da view pedida", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const otherView = {
      view: "table",
      name: "Outra",
      filters: { version: 2, updatedAt: null, clauses: [], groupBy: [], passthrough: [] },
    };
    const current = page({
      [VIEW_ID]: { view: "table", name: "Principal", columnWidths: { [COLUMN_ID]: 180 } },
      [OTHER_VIEW_ID]: otherView,
    });
    const filters = {
      version: 2 as const,
      updatedAt: NOW,
      clauses: [],
      groupBy: ["page_title"],
      passthrough: [] as [string, string][],
    };
    const persisted = page({
      ...(current.data as Record<string, unknown>),
      [VIEW_ID]: {
        ...(current.data[VIEW_ID] as Record<string, unknown>),
        filters,
      },
    });
    mocks.pages.find.mockResolvedValueOnce(current).mockResolvedValueOnce(persisted);

    const result = await pageViewController.updateFilters(PAGE_ID, VIEW_ID, {
      version: 2,
      clauses: [],
      groupBy: ["page_title"],
      passthrough: [],
    });

    expect(result).toEqual({ ok: true, data: { viewId: VIEW_ID, filters, data: persisted.data } });
    expect(mocks.pageJson.updatePageViewFiltersJson).toHaveBeenCalledOnce();
    expect(mocks.pageJson.updatePageViewFiltersJson).toHaveBeenCalledWith(
      PAGE_ID,
      VIEW_ID,
      filters,
    );
    expect(result.ok && result.data.data[OTHER_VIEW_ID]).toEqual(otherView);
  });

  it("recusa timestamp do cliente e não persiste nada", async () => {
    mocks.pages.find.mockResolvedValueOnce(
      page({ [VIEW_ID]: { view: "table", name: "Principal" } }),
    );

    const result = await pageViewController.updateFilters(PAGE_ID, VIEW_ID, {
      version: 2,
      updatedAt: "2000-01-01T00:00:00.000Z",
      clauses: [],
      groupBy: [],
      passthrough: [],
    });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(mocks.pageJson.updatePageViewFiltersJson).not.toHaveBeenCalled();
  });

  it("faz patch atômico sem reenviar filtros nem outras views", async () => {
    const filters = {
      version: 2,
      updatedAt: NOW,
      clauses: [],
      groupBy: [],
      passthrough: [],
    };
    const otherView = { view: "table", name: "Outra", filters };
    const current = page({
      [VIEW_ID]: {
        view: "table",
        name: "Principal",
        filters,
        columnWidths: { [COLUMN_ID]: 180 },
      },
      [OTHER_VIEW_ID]: otherView,
    });
    const persisted = page({
      ...(current.data as Record<string, unknown>),
      [VIEW_ID]: {
        ...(current.data[VIEW_ID] as Record<string, unknown>),
        columnWidths: { [COLUMN_ID]: 320 },
      },
    });
    mocks.pages.find.mockResolvedValueOnce(current).mockResolvedValueOnce(persisted);

    const result = await pageViewController.patchView(PAGE_ID, VIEW_ID, {
      columnWidths: { [COLUMN_ID]: 320 },
    });

    expect(result).toMatchObject({ ok: true, data: { changed: true, data: persisted.data } });
    expect(mocks.pageJson.updatePageJsonPaths).toHaveBeenCalledOnce();
    expect(mocks.pageJson.updatePageJsonPaths).toHaveBeenCalledWith(
      PAGE_ID,
      [{ path: [VIEW_ID, "columnWidths"], value: { [COLUMN_ID]: 320 } }],
      VIEW_ID,
    );
    expect(result.ok && result.data.data[OTHER_VIEW_ID]).toEqual(otherView);
    expect(result.ok && (result.data.view.filters as unknown)).toEqual(filters);
  });

  it.each(["grid", "board", "calendar", "timeline", "graph"])(
    "aceita o tipo de view %s no patch atômico",
    async (view) => {
      const current = page({
        [VIEW_ID]: { view: "table", name: "Principal" },
      });
      const persisted = page({
        [VIEW_ID]: { view, name: "Principal" },
      });
      mocks.pages.find.mockResolvedValueOnce(current).mockResolvedValueOnce(persisted);

      const result = await pageViewController.patchView(PAGE_ID, VIEW_ID, { view });

      expect(result).toMatchObject({ ok: true, data: { changed: true } });
      expect(mocks.pageJson.updatePageJsonPaths).toHaveBeenCalledWith(
        PAGE_ID,
        [{ path: [VIEW_ID, "view"], value: view }],
        VIEW_ID,
      );
    },
  );

  it("não deixa o patch genérico sobrescrever filters", async () => {
    const result = await pageViewController.patchView(PAGE_ID, VIEW_ID, {
      filters: { version: 2, clauses: [], groupBy: [], passthrough: [] },
    });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(mocks.pages.find).not.toHaveBeenCalled();
    expect(mocks.pageJson.updatePageJsonPaths).not.toHaveBeenCalled();
  });

  it("reconcilia legado uma vez e a segunda execução não cria novos writes", async () => {
    const legacyColumn = column();
    const reconciledColumn = column({
      publicKey: { key: "area", aliases: [] },
    });
    const legacyPage = page({
      [VIEW_ID]: {
        view: "table",
        name: "Tabela Geral",
        filters: "v=1&group=page_title",
      },
    });
    const reconciledView = {
      view: "table",
      name: "Tabela Geral",
      filters: {
        version: 2,
        updatedAt: null,
        clauses: [],
        groupBy: ["page_title"],
        passthrough: [],
      },
      urlKey: { key: "tabela_geral", aliases: [] },
      title: {
        key: "title",
        column_name: "Título",
        publicKey: { key: "titulo", aliases: [] },
      },
    };
    const reconciledPage = page({ [VIEW_ID]: reconciledView });

    mocks.pages.find
      .mockResolvedValueOnce(legacyPage)
      .mockResolvedValueOnce(reconciledPage)
      .mockResolvedValueOnce(reconciledPage);
    mocks.columns.findAll
      .mockResolvedValueOnce([legacyColumn])
      .mockResolvedValueOnce([reconciledColumn])
      .mockResolvedValueOnce([reconciledColumn]);

    const first = await pageViewController.reconcile(PAGE_ID);
    const second = await pageViewController.reconcile(PAGE_ID);

    expect(first).toMatchObject({
      ok: true,
      data: { changedPage: true, changedColumnIds: [COLUMN_ID] },
    });
    expect(second).toMatchObject({
      ok: true,
      data: { changedPage: false, changedColumnIds: [] },
    });
    expect(mocks.pageJson.commitFilterKeyReconcile).toHaveBeenCalledTimes(2);
    expect(mocks.pageJson.commitFilterKeyReconcile.mock.calls[0]?.[0]).toEqual({
      pageId: PAGE_ID,
      pagePatches: [
        { path: [VIEW_ID, "urlKey"], value: reconciledView.urlKey },
        { path: [VIEW_ID, "title"], value: reconciledView.title },
        { path: [VIEW_ID, "filters"], value: reconciledView.filters },
      ],
      columns: [{ id: COLUMN_ID, data: reconciledColumn.data }],
    });
    expect(mocks.pageJson.commitFilterKeyReconcile.mock.calls[1]?.[0]).toEqual({
      pageId: PAGE_ID,
      pagePatches: [],
      columns: [],
    });
  });

  it("mantém a key sintética de título e desloca coluna real conflitante", async () => {
    const view = {
      view: "table",
      name: "Tabela",
      urlKey: { key: "tabela", aliases: [] },
      filters: { version: 2, updatedAt: null, clauses: [], groupBy: [], passthrough: [] },
      title: {
        key: "title",
        column_name: "Título",
        publicKey: { key: "titulo", aliases: [] },
      },
    };
    const conflicting = {
      ...column({ publicKey: { key: "titulo", aliases: [] } }),
      name: "Título",
    };
    const reconciled = {
      ...conflicting,
      data: { publicKey: { key: "titulo_2", aliases: [] } },
    };
    mocks.pages.find.mockResolvedValueOnce(page({ [VIEW_ID]: view }));
    mocks.columns.findAll
      .mockResolvedValueOnce([conflicting])
      .mockResolvedValueOnce([reconciled]);

    const result = await pageViewController.reconcile(PAGE_ID);

    expect(result).toMatchObject({
      ok: true,
      data: { changedPage: false, changedColumnIds: [COLUMN_ID] },
    });
    expect(mocks.pageJson.commitFilterKeyReconcile).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      pagePatches: [],
      columns: [{ id: COLUMN_ID, data: reconciled.data }],
    });
  });
});
