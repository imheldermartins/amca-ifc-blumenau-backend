import type { Schema } from "@/db/schemas/index";
import type {
  PageCellValueInput,
  PageCellValueMapperContract,
} from "@/services/types/page-cell-value-mapper.types";
import { VALUE_CODECS } from "@/services/value-codec";

/** Fronteira entre o payload HTTP da célula e o envelope persistido. */
export class PageCellValueMapper implements PageCellValueMapperContract {
  public supports(column: Schema.PageColumn): boolean {
    return VALUE_CODECS[column.type] !== undefined;
  }

  public encode(column: Schema.PageColumn, input: PageCellValueInput): string {
    const codec = VALUE_CODECS[column.type];
    if (!codec) throw new Error("Tipo de coluna não suportado");

    const value = codec.validate(this.rawValue(column, input), column);
    return codec.encode(value);
  }

  public decode(
    row: Schema.PageColumnValue,
    column: Schema.PageColumn,
  ): Schema.DecodedColumnValue {
    const codec = VALUE_CODECS[column.type];
    if (!codec) throw new Error("Tipo de coluna não suportado");

    return {
      id: row.id,
      page_id: row.page_id,
      page_column_id: row.page_column_id,
      type: column.type,
      value: codec.decode(row.data),
    };
  }

  private rawValue(column: Schema.PageColumn, input: PageCellValueInput): unknown {
    if (column.type !== "date") return input.value;

    const { startDate, endDate, value } = input;
    if (startDate !== undefined && endDate !== undefined) return `${startDate}@${endDate}`;
    if (startDate !== undefined) return startDate;
    if (endDate !== undefined) return endDate;
    return value;
  }
}

export default new PageCellValueMapper();
