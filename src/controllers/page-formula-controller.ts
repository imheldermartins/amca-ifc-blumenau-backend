import formulas from '@/repositories/page-formula-repository';
import { PageRelationError } from '@/repositories/page-relation-repository';
import {compileFormula} from '@/services/formulas/engine/index';
import type { ServiceResult } from '@/controllers/types/service-result.types';

export class PageFormulaController {
  async catalog(pageId: string, userId: string): Promise<ServiceResult<Awaited<ReturnType<typeof formulas.catalog>>>> {
    try { return {ok:true,data:await formulas.catalog(pageId,userId)}; } catch(error) {return this.failure(error);}
  }
  async preview(pageId:string,userId:string,input:{source?:unknown;columnId?:unknown;pageId?:unknown}):Promise<ServiceResult<unknown>> {
    try {
      if(typeof input.source!=='string' || (input.columnId!==undefined && typeof input.columnId!=='string') || (input.pageId!==undefined && typeof input.pageId!=='string')) throw new PageRelationError(400,'Prévia inválida');
      const catalog=await formulas.catalog(pageId,userId);
      const compiled=compileFormula(input.source,{catalog,databaseId:pageId,...(typeof input.columnId==='string'&&{columnId:input.columnId})});
      if(!compiled.ok)return {ok:true,data:compiled};
      const results=typeof input.pageId==='string' ? await formulas.evaluate(pageId,input.source,typeof input.columnId==='string'?input.columnId:undefined,[input.pageId],userId,catalog):undefined;
      return {ok:true,data:{ok:true,source:compiled.canonicalSource,valueType:compiled.valueType,references:compiled.references,...(results&&{result:results[String(input.pageId)]})}};
    }catch(error){return this.failure(error);}
  }
  private failure(error:unknown):ServiceResult<never>{
    if(error instanceof PageRelationError)return {ok:false,reason:error.status===403?'forbidden':error.status===409?'conflict':'validation',message:error.message};
    console.error('[formula]',error); return {ok:false,reason:'server_error',message:'Não foi possível carregar a fórmula'};
  }
}
export default new PageFormulaController();
