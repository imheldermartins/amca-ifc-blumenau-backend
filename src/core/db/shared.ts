import sendRequest from "@/utils/sendRequest";
import { RAFT_URL } from "@/constants/raft_url";

const WORKSPACE_DB_API_URL = RAFT_URL;

type Endpoint = 'query' | 'execute' | 'request';
type RqliteOptions = { transaction?: boolean };

const isError = <T = any>(res: Result<T>): res is ErrorQuerying => 'error' in res;

function isQuery<T>(res: Result<T>): res is QuerySuccess<T> {
  return res && !isError(res) && 'rows' in res && 'types' in res;
}

function isExecute<T = never>(res: Result<T>): res is ExecuteSuccess {
  // O rqlite só devolve `last_insert_id` em INSERT. UPDATE e DELETE bem
  // sucedidos trazem apenas `rows_affected` (e, em versões recentes,
  // `rows: null`). Em `/db/request`, um INSERT condicional sem efeito também
  // pode vir como `{ last_insert_id, rows: null }`, sem `rows_affected`.
  return res && !isError(res) && (
    typeof (res as { rows_affected?: unknown }).rows_affected === 'number'
    || (
      typeof (res as { last_insert_id?: unknown }).last_insert_id === 'number'
      && (res as { rows?: unknown }).rows === null
    )
  );
}

/**
 * Normaliza a resposta heterogênea do rqlite para o contrato usado pelo Model.
 *
 * Cada resposta reconhecida ocupa uma posição, preservando o alinhamento de
 * batches mistos. Escrita é sucesso quando atingiu ao menos uma linha;
 * `last_insert_id` sozinho só identifica uma escrita válida sem efeito.
 */
export function parseRqliteResults<T>(
  results: SQLResponse<T>["results"] | null | undefined,
): SuccessResult<T>[] {
  if (!results || !Array.isArray(results))
    throw new Error('Results is invalid.', { cause: 'SQLERROR' });

  const validRows: SuccessResult<T>[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (isError(result)) {
      errors.push(result.error);
    } else if (isExecute(result)) {
      validRows.push(typeof result.rows_affected === 'number' && result.rows_affected > 0);
    } else if (isQuery<T>(result)) {
      validRows.push(result.rows);
    }
  }

  if (errors.length > 0)
    throw new Error(errors.map(err => `[${err}]`).join('\n'), { cause: 'SQLERROR' });

  return validRows;
}

export function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: 'query',
  options?: RqliteOptions,
): Promise<T[][]>;
export function rqlite<T = never>(
  sqlQueries: RqliteStatement[],
  endpoint: 'execute',
  options?: RqliteOptions,
): Promise<boolean[]>;
export function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: 'request',
  options?: RqliteOptions,
): Promise<SuccessResult<T>[]>;
export function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: Endpoint,
  options?: RqliteOptions,
): Promise<SuccessResult<T>[]>;
export async function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: Endpoint,
  options: RqliteOptions = {},
): Promise<SuccessResult<T>[]> {
  const transaction = options.transaction ? "&transaction" : "";
  const response = await sendRequest<SQLResponse<T>>(
    "post",
    `${WORKSPACE_DB_API_URL}/db/${endpoint}?pretty&associative${transaction}`,
    [...sqlQueries],
  );

  return parseRqliteResults(response?.results);
}

/**
 * @example Query: 
 *  Essa função será responsável apenas para requisições de leitura, ou seja, `SELECT`.
 * @example Execute: 
 *  Essa função será responsável apenas para requisições de escrita, ou seja, `CREATE | INSERT | UPDATE | ALTER, etc`.
 * @example Request: 
 *  Essa função será responsável apenas para requisições de leitura e escrita.
 * @param sql : Comando SQL que será enviado para execução.
 */
async function sql<T>(
  statement: string | SqlStatement,
  endpoint: Endpoint = 'request',
): Promise<SuccessResult<T> | null> {

  // String simples segue crua; statement parametrizado vira `[text, ...values]`,
  // o formato de bind que o rqlite espera.
  const wire: RqliteStatement =
    typeof statement === "string" ? statement : [statement.text, ...statement.values];

  const [rows] = await rqlite<T>([wire], endpoint);

  return rows ?? null;
}


export default sql;
