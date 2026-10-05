import { ulid } from "ulid";
import type { Schema } from "@/db/schemas/index";
import type {
  PageViewCreateInput,
  PageViewDraft,
} from "@/services/pages/views/types/page-view.types";
import { PageViewSnapshot } from "@/services/pages/views/page-view-snapshot";
import { collectReservedPublicKeys, reconcilePublicKeyMetadata } from "@/services/public-key";
import { readDeletedColumnKeys } from "@/services/filter-key-registry";
import {
  assertFormFlowColumn,
  isJsonRecord,
  parsePageViewFormConfig,
  toColumnKeyEntities,
} from "@/services/pages/views/page-view-parsers";
import { ViewFiltersValidationError } from "@/services/view-filters-v2";

export class PageViewFactory {
  public create(
    snapshot: PageViewSnapshot,
    columns: readonly Schema.PageColumn[],
    input: PageViewCreateInput,
  ): PageViewDraft {
    if (input.kind === "form") {
      if (!input.form) {
        throw new ViewFiltersValidationError("Configuração do formulário obrigatória");
      }
      assertFormFlowColumn(input.form, columns);
    }
    const reservedTitleKeys = collectReservedPublicKeys(
      toColumnKeyEntities(columns),
      "coluna",
    );
    readDeletedColumnKeys(snapshot.data).forEach((key) => reservedTitleKeys.add(key));

    return {
      viewId: ulid(),
      view: {
        view: input.kind,
        name: input.name,
        urlKey: reconcilePublicKeyMetadata(
          input.name,
          "view",
          undefined,
          collectReservedPublicKeys(snapshot.keyEntities(), "view"),
        ),
        filters: {
          version: 2,
          updatedAt: null,
          clauses: [],
          groupBy: [],
          passthrough: [],
        },
        title: {
          ...input.title,
          publicKey: reconcilePublicKeyMetadata(
            input.title.column_name,
            "coluna",
            undefined,
            reservedTitleKeys,
          ),
        },
        orderedHeaderCols: [],
        order: snapshot.nextOrder(),
        ...(input.form && { form: input.form }),
      },
    };
  }

  public duplicate(
    snapshot: PageViewSnapshot,
    columns: readonly Schema.PageColumn[],
    sourceViewId: string,
  ): PageViewDraft | null {
    const source = snapshot.active(sourceViewId);
    if (!source) return null;

    if (source.view === "form") {
      if (!isJsonRecord(source.form)) {
        throw new ViewFiltersValidationError("Configuração do formulário inválida");
      }
      assertFormFlowColumn(parsePageViewFormConfig(source.form), columns);
    }

    const sourceName =
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim()
        : "View";
    const suffix = " (cópia)";
    const name = `${sourceName.slice(0, 120 - suffix.length)}${suffix}`;

    return {
      viewId: ulid(),
      view: {
        ...source,
        name,
        order: snapshot.nextOrder(),
        urlKey: reconcilePublicKeyMetadata(
          name,
          "view",
          undefined,
          collectReservedPublicKeys(snapshot.keyEntities(), "view"),
        ),
      },
    };
  }
}
