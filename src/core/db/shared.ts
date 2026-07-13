import sendRequest from "@/utils/sendRequest";
import { RAFT_URL } from "@/constants/raft_url";

const WORKSPACE_DB_API_URL = RAFT_URL;

type Endpoint = 'query' | 'execute' | 'request';

const isError = <T = any>(res: Result<T>): res is ErrorQuerying => 'error' in res;

function isQuery<T>(res: Result<T>): res is QuerySuccess<T> {
  return res && !isError(res) && 'rows' in res && 'types' in res;
}

function isExecute<T = never>(res: Result<T>): res is ExecuteSuccess {
  return res && !isError(res) && 'last_insert_id' in res && 'rows_affected' in res;
}

export async function rqlite<T>(
  sqlQueries: RqliteStatement[],
  endpoint: Endpoint
): Promise<SQLResponse<T>["results"]> {
  const response = await sendRequest<SQLResponse<T>>(
    "post",
    `${WORKSPACE_DB_API_URL}/db/${endpoint}?pretty&associative`,
    [...sqlQueries],
  ) as SQLResponse<T>;

  const results = response.results;

  const validRows: SuccessResult<T>[] = [];
  const errors: string[] = [];

  if (!results || !Array.isArray(results))
    throw new Error('Results is invalid.', { cause: 'SQLERROR' })

  for (const result of results) {

    if (isError(result)) {
      errors.push(result.error);
    } else if (isExecute(result)) {
      validRows.push(!!result.last_insert_id);
    } else if (isQuery<T>(result)) {
      validRows.push(result.rows);
    }
  }

  if (errors.length > 0) throw new Error(errors.map(err => `[${err}]`).join('\n'), { cause: 'SQLERROR' });

  return validRows;
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

  return rows;
}


export default sql;
