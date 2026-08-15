import sendRequest from "@/utils/sendRequest";
import { RAFT_URL } from "@/constants/raft_url";

const WORKSPACE_DB_API_URL = RAFT_URL;

type Endpoint = 'query' | 'execute' | 'request';

const isError = <T = any>(res: Result<T>): res is ErrorQuerying => 'error' in res;

function isQuery<T>(res: Result<T>): res is QuerySuccess<T> {
  return res && !isError(res) && 'rows' in res && 'types' in res;
}

function isExecute<T = never>(res: Result<T>): res is ExecuteSuccess {
  // O rqlite só devolve `last_insert_id` em INSERT. UPDATE e DELETE bem
  // sucedidos trazem apenas `rows_affected` (e, em versões recentes,
  // `rows: null`). Exigir os dois campos fazia a escrita ser efetivada e,
  // ainda assim, chegar ao Model como falha.
  return res && !isError(res) && 'rows_affected' in res;
}

/**
 * Normaliza a resposta heterogênea do rqlite para o contrato usado pelo Model.
 *
 * Escrita é sucesso quando atingiu ao menos uma linha. `last_insert_id` não é
 * um indicador genérico: ele não existe em UPDATE/DELETE.
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
      validRows.push(result.rows_affected > 0);
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
): Promise<T[][]>;
export function rqlite<T = never>(
  sqlQueries: RqliteStatement[],
  endpoint: 'execute',
): Promise<boolean[]>;
export function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: 'request',
): Promise<SuccessResult<T>[]>;
export function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: Endpoint,
): Promise<SuccessResult<T>[]>;
export async function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: Endpoint
): Promise<SuccessResult<T>[]> {
  const response = await sendRequest<SQLResponse<T>>(
    "post",
    `${WORKSPACE_DB_API_URL}/db/${endpoint}?pretty&associative`,
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
