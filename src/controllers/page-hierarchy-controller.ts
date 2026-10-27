import type { Input } from "@/db/schemas/inputs";
import pageHierarchyStore, { PageHierarchyStore } from "@/repositories/page-hierarchy-repository";
import { isUlid } from "@/utils/ulid";
import formulas from '@/repositories/page-formula-repository';
import type { PageDatasetRow } from '@/repositories/types/page-hierarchy-repository.types';
import {PageChildInputError} from '@/repositories/page-child-values';

/** Regras de entrada e tratamento de falhas para a árvore de páginas. */
export class PageHierarchyController {
  public constructor(private readonly hierarchy: PageHierarchyStore = pageHierarchyStore) {}

  public async getParentId(pageId: string): Promise<string | null> {
    if (!isUlid(pageId)) return null;
    try {
      return await this.hierarchy.getParentId(pageId);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public async createChild(parentId: string, ownerId: string, input: Input.CreateChildPage) {
    if (!isUlid(parentId) || !isUlid(ownerId)) return null;
    try {
      return await this.hierarchy.createChild(parentId, ownerId, input);
    } catch (error) {
      if (error instanceof PageChildInputError) throw error;
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public async getDataset(parentId: string) {
    if (!isUlid(parentId)) return null;
    try {
      return await this.hierarchy.findDataset(parentId);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public async getBreadcrumb(pageId: string) {
    if (!isUlid(pageId)) return null;
    try {
      return await this.hierarchy.findBreadcrumb(pageId);
    } catch (error) {
      if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
      return null;
    }
  }

  public async resolveFormulas(parentId: string, userId: string, rows: PageDatasetRow[]) {
    if (!rows.length) return rows;
    const catalog = await formulas.catalog(parentId,userId,false);
    const columns = catalog.filter(symbol=>symbol.type==='formula');
    if (!columns.length) return rows;
    for(let offset=0;offset<rows.length;offset+=50){
        const batch=rows.slice(offset,offset+50);
        const calculated=await formulas.evaluateColumns(parentId,columns.map(column=>({id:column.id,source:column.source??''})),batch.map(row=>row.page_id),userId);
      for (const column of columns) {
        const results=calculated[column.id]!;
        for(const row of batch){
          const result=results[row.page_id];
          row.page_columns[column.id]={row_id:null,column_name:column.name,column_type:'formula',column_data:JSON.stringify({formula:{version:1,source:column.source}}),row_data:JSON.stringify({value:result?.ok?result.value:{kind:'formula-error',message:result?.error.message??'Fórmula indisponível'}})};
        }
      }
    }
    return rows;
  }
}

export default new PageHierarchyController();
