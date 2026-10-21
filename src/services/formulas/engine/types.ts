/** Portable formula contracts. This module deliberately has no application dependencies. */
export type FormulaScalar = number | string | boolean | null;
export type FormulaColor = 'red' | 'pink' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'grey';
export interface FormulaMarkup { kind: 'markup'; value: FormulaScalar; color: FormulaColor }
export interface FormulaPages { kind: 'pages'; databaseId: string; ids: string[] }
export type FormulaValue = FormulaScalar | FormulaMarkup | FormulaPages | FormulaValue[];
export type FormulaType =
  | { kind: 'number' | 'text' | 'boolean' | 'null' }
  | { kind: 'list' | 'chip'; item: FormulaType }
  | { kind: 'pages'; databaseId: string }
  | { kind: 'union'; options: FormulaType[] };
export interface FormulaSymbol {
  id: string; name: string; type: string; databaseId: string;
  targetDatabaseId?: string;
  source?: string;
  options?: readonly { id: string; value: string }[];
}
export interface ResolvedFormulaSymbol extends FormulaSymbol { rooted: boolean; title?: boolean }
export interface FormulaSpan { start: number; end: number }
export interface FormulaDiagnostic extends FormulaSpan { code: string; message: string }
export interface FormulaDependency { columnId: string; databaseId: string; scope: 'root' | 'current'; name: string }
interface NodeBase extends FormulaSpan { valueType?: FormulaType }
export interface LiteralNode extends NodeBase { kind: 'literal'; value: FormulaScalar }
export interface ReferenceNode extends NodeBase {
  kind: 'reference'; raw: string; symbol?: ResolvedFormulaSymbol; formula?: CompiledFormula;
}
export interface OperationNode extends NodeBase { kind: 'call' | 'unary' | 'binary'; name: string; args: FormulaNode[] }
export type FormulaNode = LiteralNode | ReferenceNode | OperationNode;
export interface FormulaReference extends FormulaSpan { symbol: ResolvedFormulaSymbol; valueType: FormulaType }
export interface CompiledFormula {
  ok: true; version: 1; ast: FormulaNode; valueType: FormulaType;
  source: string; canonicalSource: string; dependencies: FormulaDependency[];
  references: FormulaReference[]; nodes: number; databaseId: string;
}
export interface FormulaCompileError { ok: false; diagnostics: FormulaDiagnostic[] }
export type CompileResult = CompiledFormula | FormulaCompileError;
export interface CompileOptions {
  catalog: readonly FormulaSymbol[]; databaseId: string; rootDatabaseId?: string; columnId?: string;
}
export interface FormulaPage {
  id: string; databaseId: string; title?: string | null; values: Readonly<Record<string, unknown>>;
  readable?: boolean; deleted?: boolean;
}
export interface FormulaContext {
  pageId: string; pages: Readonly<Record<string, FormulaPage>>;
  canRead?: (page: FormulaPage) => boolean;
  canReadColumn?: (page: FormulaPage, symbol: FormulaSymbol) => boolean;
}
export type EvaluationResult =
  | { ok: true; value: FormulaValue; valueType: FormulaType; steps: number }
  | { ok: false; error: FormulaDiagnostic; steps?: number };
export interface EvaluationOptions { steps?: number }
export interface FormulaToken extends FormulaSpan {
  kind: 'number' | 'string' | 'reference' | 'identifier' | 'operator' | '(' | ')' | ',' | '.' | ';' | 'eof';
  value: string | number;
}
export interface InferenceApi {
  infer: (node: FormulaNode) => FormulaType;
  inScope: (databaseId: string) => Pick<InferenceApi, 'infer'>;
}
export interface EvaluationApi {
  evaluate: (node: FormulaNode) => FormulaValue;
  inPage: (pageId: string) => Pick<EvaluationApi, 'evaluate'>;
  spend: (cost: number, node: FormulaSpan) => void;
}
export interface OperationMetadata {
  name: string; group: string; syntax: string; description: string; strategy: 'eager' | 'lazy' | 'scoped';
}
interface OperationBase {
  infer: (args: FormulaNode[], api: InferenceApi, node: FormulaSpan) => FormulaType;
  precedence?: number;
}
export type FormulaOperation = OperationBase & (
  | { strategy: 'eager'; run: (args: FormulaValue[], api: EvaluationApi, node: FormulaSpan) => FormulaValue }
  | { strategy: 'lazy' | 'scoped'; run: (args: FormulaNode[], api: EvaluationApi, node: FormulaSpan) => FormulaValue }
);
