import type { Schema } from "@/db/schemas/index";
import type { JsonRecord } from "@/services/types/json.types";
import type { PageViewPatchPlan } from "@/services/pages/views/types/page-view.types";
import { PageViewSnapshot } from "@/services/pages/views/page-view-snapshot";
import {
  isJsonRecord,
  isSupportedViewKind,
  parseColumnWidths,
  parsePageViewTitle,
  parseStringList,
  toColumnKeyEntities,
  valuesEqual,
} from "@/services/pages/views/page-view-parsers";
import { ViewFiltersValidationError } from "@/services/view-filters-v2";
import { collectReservedPublicKeys, reconcilePublicKeyMetadata } from "@/services/public-key";
import { readDeletedColumnKeys } from "@/services/filter-key-registry";

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
      set("orderedRows", parseStringList(raw.orderedRows, "Ordem de linhas"));
    }
    if (raw.columnWidths !== undefined) {
      set("columnWidths", parseColumnWidths(raw.columnWidths));
    }

    return { patches };
  }
}
