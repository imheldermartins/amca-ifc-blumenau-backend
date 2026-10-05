import type { Schema } from "@/db/schemas/index";
import type { JsonRecord } from "@/services/types/json.types";
import type { PageViewPatchPlan } from "@/services/pages/views/types/page-view.types";
import { PageViewSnapshot } from "@/services/pages/views/page-view-snapshot";
import {
  isJsonRecord,
  isUlid,
  isSupportedViewKind,
  assertFormFlowColumn,
  parseColumnWidths,
  parsePageViewFormConfig,
  parsePageViewTitle,
  parseStringList,
  toColumnKeyEntities,
  valuesEqual,
} from "@/services/pages/views/page-view-parsers";
import { ViewFiltersValidationError } from "@/services/view-filters-v2";
import { collectReservedPublicKeys, reconcilePublicKeyMetadata } from "@/services/public-key";
import { readDeletedColumnKeys } from "@/services/filter-key-registry";
import { parseBoardPatch } from '@/services/pages/views/page-board-config';

export class PageViewPatchPlanner {
  public plan(
    snapshot: PageViewSnapshot,
    columns: readonly Schema.PageColumn[],
    viewId: string,
    current: JsonRecord,
    raw: JsonRecord,
  ): PageViewPatchPlan {
    const patches: PageViewPatchPlan["patches"] = [];
    const set = (field: string, value: unknown) => {
      if (!valuesEqual(current[field], value)) {
        patches.push({ path: [viewId, field], value });
      }
    };

    if (raw.view !== undefined) {
      if (!isSupportedViewKind(raw.view)) {
        throw new ViewFiltersValidationError("Tipo de view inválido");
      }
      set("view", raw.view);
    }

    const targetKind = raw.view ?? current.view;
    if (raw.board !== undefined) {
      const board = parseBoardPatch(raw.board, current.board, columns);
      const previous = isJsonRecord(current.board) ? current.board : {};
      for (const [field, value] of Object.entries(board)) {
        if (!valuesEqual(previous[field], value)) patches.push({ path: [viewId, 'board', field], value });
      }
    }
    const requestedForm = raw.form === undefined
      ? current.form
      : parsePageViewFormConfig(raw.form);
    if (targetKind === "form") {
      if (requestedForm === undefined) {
        throw new ViewFiltersValidationError("Configuração do formulário obrigatória");
      }
      const form = parsePageViewFormConfig(requestedForm);
      assertFormFlowColumn(form, columns);
      if (raw.form !== undefined) set("form", form);
    } else if (raw.form !== undefined) {
      throw new ViewFiltersValidationError("Configuração de formulário incompatível com a view");
    }

    if (raw.name !== undefined) {
      if (
        typeof raw.name !== "string" ||
        !raw.name.trim() ||
        raw.name.trim().length > 120
      ) {
        throw new ViewFiltersValidationError("Nome inválido");
      }
      const name = raw.name.trim();
      set("name", name);
      set(
        "urlKey",
        reconcilePublicKeyMetadata(
          name,
          "view",
          current.urlKey,
          collectReservedPublicKeys(snapshot.keyEntities(viewId), "view"),
          { forceRename: name !== current.name },
        ),
      );
    }

    if (raw.title !== undefined) {
      const title = parsePageViewTitle(raw.title);
      const reserved = collectReservedPublicKeys(
        toColumnKeyEntities(columns),
        "coluna",
      );
      readDeletedColumnKeys(snapshot.data).forEach((key) => reserved.add(key));
      const previousTitle = isJsonRecord(current.title) ? current.title : undefined;
      const publicKey = reconcilePublicKeyMetadata(
        title.column_name,
        "coluna",
        previousTitle?.publicKey,
        reserved,
        { forceRename: title.column_name !== previousTitle?.column_name },
      );
      set("title", { ...title, publicKey });
    }

    if (raw.orderedHeaderCols !== undefined) {
      set(
        "orderedHeaderCols",
        parseStringList(raw.orderedHeaderCols, "Ordem de colunas"),
      );
    }
    if (raw.orderedRows !== undefined) {
      if (isJsonRecord(current.rowOrder) && current.rowOrder.version === 2) {
        throw new ViewFiltersValidationError('A ordem desta view usa movimentos por âncoras; recarregue a página');
      }
      set("orderedRows", parseStringList(raw.orderedRows, "Ordem de linhas"));
    }
    if (raw.columnWidths !== undefined) {
      set("columnWidths", parseColumnWidths(raw.columnWidths));
    }
    if (raw.tileSize !== undefined) {
      if (!["small", "medium", "large"].includes(raw.tileSize as string)) {
        throw new ViewFiltersValidationError("Tamanho dos cards inválido");
      }
      set("tileSize", raw.tileSize);
    }
    if (raw.dateColumnId !== undefined) {
      const column = isUlid(raw.dateColumnId)
        ? columns.find((candidate) => candidate.id === raw.dateColumnId)
        : undefined;
      if (!column || column.type !== "date") {
        throw new ViewFiltersValidationError("Coluna de data inválida");
      }
      set("dateColumnId", raw.dateColumnId);
    }
    if (raw.colorColumnId !== undefined) {
      if (raw.colorColumnId === null) {
        set("colorColumnId", null);
      } else {
        const column = isUlid(raw.colorColumnId)
          ? columns.find((candidate) => candidate.id === raw.colorColumnId)
          : undefined;
        if (!column || column.type !== "select") {
          throw new ViewFiltersValidationError("Coluna de cor inválida");
        }
        set("colorColumnId", raw.colorColumnId);
      }
    }
    if (raw.calendarPropertyIds !== undefined) {
      const propertyIds = parseStringList(
        raw.calendarPropertyIds,
        "Propriedades visíveis do calendário",
      );
      if (
        propertyIds.some(
          (id) => !isUlid(id) || !columns.some((column) => column.id === id),
        )
      ) {
        throw new ViewFiltersValidationError(
          "Propriedades visíveis do calendário inválidas",
        );
      }
      set("calendarPropertyIds", propertyIds);
    }
    if (raw.calendarShowPropertyLabels !== undefined) {
      if (typeof raw.calendarShowPropertyLabels !== "boolean") {
        throw new ViewFiltersValidationError(
          "Visibilidade dos nomes das propriedades do calendário inválida",
        );
      }
      set("calendarShowPropertyLabels", raw.calendarShowPropertyLabels);
    }

    return { patches };
  }
}
