import db from '@models/index';
import {rqlite} from '@/db/client-db';
import type { Schema } from '@/db/schemas/index';
import { accessGuard, correlatedPageReadGuard } from '@/repositories/scoped-access-repository';
import relations, { PageRelationError } from '@/repositories/page-relation-repository';
import { pageActivityTouchStatement } from '@/repositories/page-activity';
import { compileFormula, evaluateFormula, type CompiledFormula, type FormulaNode, type FormulaPage, type FormulaSymbol, type EvaluationResult } from '@/services/formulas/engine/index';
import { ULID_RE } from '@/utils/ulid';

interface ColumnRow { id: string; name: string | null; type: string; parent_id: string; data: string }
const parse = (data: string): Schema.PageColumnData => { try { return JSON.parse(data) as Schema.PageColumnData; } catch { return {}; } };
const limit = (condition: boolean) => { if (condition) throw new PageRelationError(400, 'A fórmula excedeu o limite de propriedades ou páginas relacionadas'); };
export type FormulaCommit = (statements: RqliteStatement[], endpoint: 'execute', options: {transaction: true}) => Promise<boolean[]>;

/** All formula I/O is authorized, bounded and scoped to the current request. */
export class PageFormulaRepository {
  constructor(private readonly execute: typeof db.sqlRaw = db.sqlRaw, private readonly commit: FormulaCommit = rqlite) {}

  async catalog(databaseId: string, userId: string, includeRelated = true): Promise<FormulaSymbol[]> {
    if (!ULID_RE.test(databaseId)) throw new PageRelationError(400, 'Página inválida');
    const result: FormulaSymbol[] = [], seen = new Set<string>();
    let pending = [databaseId];
    while (pending.length) {
      const current = pending.shift()!;
      if (seen.has(current)) continue;
      seen.add(current); limit(seen.size > 32);
      const guard = accessGuard('page', current, userId, 'read', 'view');
      const rows = await this.execute<ColumnRow>({
        text: `SELECT id,name,type,parent_id,data FROM page_columns WHERE parent_id=? AND deleted_at IS NULL AND ${guard.text} ORDER BY id LIMIT 513`,
        values: [current, ...guard.values],
      }, 'query');
      limit(result.length + rows.length > 512);
      for (const row of rows) {
        const data = parse(row.data);
        result.push({id: row.id, name: row.name ?? '', type: row.type, databaseId: current,
          ...(data.formula && {source: data.formula.source}), ...(data.options && {options: data.options}),
          ...(data.relation && {targetDatabaseId: data.relation.targetDatabaseId})});
        if (includeRelated && row.type === 'relation' && data.relation) pending.push(data.relation.targetDatabaseId);
      }
    }
    return result;
  }

  async definition(databaseId: string, userId: string, input: Schema.FormulaInput | undefined, columnId?: string, previous?: Schema.FormulaConfig): Promise<Schema.FormulaConfig> {
    if (!input || input.version !== 1 || typeof input.source !== 'string'
      || Object.keys(input).some(key => !['version','source','expectedRevision'].includes(key))) throw new PageRelationError(400, 'Configuração de fórmula inválida');
    if (previous && input.expectedRevision !== previous.revision) throw new PageRelationError(409, 'Esta fórmula foi alterada. Reabra o editor para continuar.');
    const catalog = await this.catalog(databaseId, userId);
    const compiled = compileFormula(input.source, {catalog, databaseId, ...(columnId && {columnId})});
    if (!compiled.ok) throw new PageRelationError(400, compiled.diagnostics[0]?.message ?? 'Fórmula inválida');
    // Persist only authoritative metadata; never accept a client AST/result.
    return {version:1, source:compiled.canonicalSource, revision:(previous?.revision ?? 0)+1, resultType:compiled.valueType, dependencies:compiled.dependencies};
  }

  async compareAndUpdate(existing: Schema.PageColumn, payload: UpdateValues<Schema.PageColumn>): Promise<boolean> {
    const statements: RqliteStatement[] = [[
      `UPDATE page_columns SET name=?,type=?,data=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND deleted_at IS NULL AND type=? AND name IS ? AND json(data)=json(?)`,
      payload.name === undefined ? existing.name : payload.name, payload.type ?? existing.type, JSON.stringify(payload.data ?? existing.data), existing.id, existing.type, existing.name, JSON.stringify(existing.data),
    ]];
    if (existing.parent_id) {
      const [text, ...values] = pageActivityTouchStatement(existing.parent_id);
      statements.push([`${text} AND changes()>0`, ...values]);
    }
    const results = await this.commit(statements, 'execute', {transaction: true});
    return results[0] === true;
  }

  private symbols(compiled: CompiledFormula): FormulaSymbol[] {
    const found = new Map<string, FormulaSymbol>();
    const visit = (node: FormulaNode) => {
      if (node.kind === 'reference') { if (node.symbol) found.set(node.symbol.id,node.symbol); if (node.formula) visit(node.formula.ast); }
      else if (node.kind !== 'literal') node.args.forEach(visit);
    };
    visit(compiled.ast); return [...found.values()];
  }

  async evaluate(databaseId: string, source: string, columnId: string | undefined, pageIds: readonly string[], userId: string, suppliedCatalog?: FormulaSymbol[]): Promise<Record<string, EvaluationResult>> {
    try { return await this.evaluatePages(databaseId,source,columnId,pageIds,userId,suppliedCatalog); }
    catch(error) {
      if (!(error instanceof PageRelationError)) throw error;
      return Object.fromEntries(pageIds.map(id=>[id,{ok:false,error:{code:'CONTEXT_LIMIT',message:error.message,start:0,end:1}}]));
    }
  }

  async evaluateColumns(databaseId: string, columns: readonly {id: string; source: string}[], pageIds: readonly string[], userId: string): Promise<Record<string, Record<string, EvaluationResult>>> {
    if (!columns.length || !pageIds.length) return {};
    let catalog: FormulaSymbol[];
    try { catalog = await this.catalog(databaseId, userId); }
    catch (error) {
      if (!(error instanceof PageRelationError)) throw error;
      const failures: Record<string, EvaluationResult> = Object.fromEntries(pageIds.map(id => [id, {ok: false, error: {code: 'CONTEXT_LIMIT', message: error.message, start: 0, end: 1}}]));
      return Object.fromEntries(columns.map(column => [column.id, failures]));
    }
    const results: Record<string, Record<string, EvaluationResult>> = {};
    for (const column of columns) results[column.id] = await this.evaluate(databaseId, column.source, column.id, pageIds, userId, catalog);
    return results;
  }

  private async evaluatePages(databaseId: string, source: string, columnId: string | undefined, pageIds: readonly string[], userId: string, suppliedCatalog?: FormulaSymbol[]): Promise<Record<string, EvaluationResult>> {
    const catalog = suppliedCatalog ?? await this.catalog(databaseId, userId);
    const compiled = compileFormula(source, {catalog,databaseId,...(columnId && {columnId})});
    if (!compiled.ok) return Object.fromEntries(pageIds.map(id => [id,{ok:false,error:compiled.diagnostics[0]!}]));
    const symbols = this.symbols(compiled), pages: Record<string,FormulaPage> = {};
    const seen = new Set<string>(); let pending = [...pageIds]; let depth = 0;
    while (pending.length) {
      limit(++depth > 16);
      const next = new Set<string>();
      for (let offset=0; offset<pending.length; offset+=200) {
        const ids = pending.slice(offset,offset+200).filter(id => ULID_RE.test(id) && !seen.has(id));
        ids.forEach(id => seen.add(id)); limit(seen.size > 2500);
        if (!ids.length) continue;
        const guard = correlatedPageReadGuard('p.id',userId), parentGuard = correlatedPageReadGuard('e.parent_id',userId);
        const rows = await this.execute<{id:string;title:string|null;databaseId:string}>({
          text:`SELECT p.id,p.title,e.parent_id AS databaseId FROM pages p JOIN page_edges e ON e.child_id=p.id WHERE p.id IN (${ids.map(()=>'?').join(',')}) AND p.deleted_at IS NULL AND ${guard.text} AND ${parentGuard.text}`,
          values:[...ids,...guard.values,...parentGuard.values],
        },'query');
        for (const row of rows) pages[row.id]={...row,values:{}};
        const columns = symbols.filter(s=> rows.some(r=>r.databaseId===s.databaseId) && !['formula','title'].includes(s.type));
        if (rows.length && columns.length) {
          const cells = await this.execute<{page_id:string;page_column_id:string;data:string}>({
            text:`SELECT page_id,page_column_id,data FROM page_columns_values WHERE page_id IN (${rows.map(()=>'?').join(',')}) AND page_column_id IN (${columns.map(()=>'?').join(',')})`,
            values:[...rows.map(r=>r.id),...columns.map(c=>c.id)],
          },'query');
          for (const cell of cells) {
            let value:unknown=null; try {value=(JSON.parse(cell.data) as {value:unknown}).value;} catch { /* invalid legacy cells remain empty */ }
            const page=pages[cell.page_id]!, symbol=columns.find(s=>s.id===cell.page_column_id);
            if (!symbol || symbol.databaseId!==page.databaseId) continue;
            (page.values as Record<string,unknown>)[cell.page_column_id]=value;
            if(symbol.type==='relation' && Array.isArray(value)) { limit(value.length>250); value.forEach(id=>{if(typeof id==='string'&&!seen.has(id))next.add(id);}); }
          }
          for (const symbol of columns.filter(c=>c.type==='extract_as')) {
            const [column]=await this.execute<{data:string}>({text:'SELECT data FROM page_columns WHERE id=? AND deleted_at IS NULL',values:[symbol.id]},'query');
            if (!column) continue;
            const values=await relations.resolveRollupValues({data:parse(column.data)},rows.filter(r=>r.databaseId===symbol.databaseId).map(r=>r.id),userId);
            for (const [id,value] of Object.entries(values)) (pages[id]!.values as Record<string,unknown>)[symbol.id]=value;
          }
        }
      }
      pending=[...next];
    }
    return Object.fromEntries(pageIds.map(pageId=>[pageId,evaluateFormula(compiled,{pageId,pages})]));
  }

  async affectedDatabases(databaseId: string): Promise<string[]> {
    const rows=await this.execute<{id:string}>({text:`WITH RECURSIVE affected(id) AS (
      SELECT ? UNION SELECT c.parent_id FROM page_columns c JOIN affected a ON json_extract(c.data,'$.relation.targetDatabaseId')=a.id
      WHERE c.type='relation' AND c.deleted_at IS NULL
    ) SELECT DISTINCT id FROM affected WHERE id IS NOT NULL
      AND EXISTS(SELECT 1 FROM page_columns f WHERE f.parent_id=affected.id AND f.type='formula' AND f.deleted_at IS NULL)`,values:[databaseId]},'query');
    return rows.map(r=>r.id);
  }
}
export default new PageFormulaRepository();
