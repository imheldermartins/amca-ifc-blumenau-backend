import { pageActivityTouchStatement } from "@/repositories/page-activity";
import type {
  PageCellStoreContract,
  PageCellUpdate,
  PageCellWrite,
} from "@/repositories/types/page-cell-repository.types";
import db from "@models/index";
import type { Schema } from "@/db/schemas/index";
import {deriveCellProjection} from '@/repositories/page-value-projection';

/**
 * Persistência das células e da relação estrutural row/column.
 *
 * Uma coluna só forma uma célula com a página quando pertence à parent direta
 * dessa página. A store mantém essa regra junto das consultas que a comprovam
 * e mantém o touch da página na mesma transação de cada escrita.
 */
export class PageCellStore implements PageCellStoreContract {
  public constructor(
    private readonly cells = db.pageColumnValues,
    private readonly columns = db.pageColumns,
    private readonly edges = db.pageEdges,
  ) {}

  public findCell(pageId: NonEmptyString, columnId: NonEmptyString): Promise<Schema.PageColumnValue | null> {
    return this.cells.find({
      page_id: pageId,
      page_column_id: columnId,
    } satisfies LookupValues<Schema.PageColumnValue>);
  }

  public async findColumnForCell(
    pageId: NonEmptyString,
    columnId: NonEmptyString,
  ): Promise<Schema.PageColumn | null> {
    const column = await this.columns.find({
      id: columnId,
    } satisfies LookupValues<Schema.PageColumn>);
    if (!column?.parent_id) return null;

    const edge = await this.edges.find({
      parent_id: column.parent_id,
      child_id: pageId,
    } satisfies LookupValues<Schema.PageEdge>);

    return edge ? column : null;
  }

  public createCell(input: PageCellWrite): Promise<Schema.PageColumnValue | null> {
    const values = {
      page_id: input.pageId,
      page_column_id: input.columnId,
      data: input.data,
      ...deriveCellProjection(input.data),
    } satisfies CreateValues<Schema.PageColumnValue>;

    return this.cells.create(values, {
      after: [pageActivityTouchStatement(input.pageId)],
    });
  }

  public async updateCell(input: PageCellUpdate): Promise<Schema.PageColumnValue | null> {
    const lookup = { id: input.cellId } satisfies LookupValues<Schema.PageColumnValue>;
    const updated = await this.cells.update(
      { data: input.data, ...deriveCellProjection(input.data) } satisfies UpdateValues<Schema.PageColumnValue>,
      lookup,
      { after: [pageActivityTouchStatement(input.pageId)] },
    );
    return updated ? this.cells.find(lookup) : null;
  }

  public deleteCell(cellId: NonEmptyString, pageId: NonEmptyString): Promise<boolean> {
    return this.cells.delete(
      { id: cellId } satisfies LookupValues<Schema.PageColumnValue>,
      { after: [pageActivityTouchStatement(pageId)] },
    );
  }
}

export default new PageCellStore();
