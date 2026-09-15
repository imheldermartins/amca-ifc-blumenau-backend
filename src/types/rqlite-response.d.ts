type ErrorQuerying = { error: string; };

type DBTypes = 'integer' | 'text';

type QuerySuccess<T> = {
    types: Record<keyof T, DBTypes>;
    rows: T[];
};

type ExecuteSuccess = {
    rows_affected: number;
    last_insert_id?: number;
    rows?: null;
} | {
    /**
     * O `/db/request` pode representar uma escrita válida sem efeito (como o
     * guard baseado em `changes()`) sem `rows_affected`.
     */
    last_insert_id: number;
    rows: null;
    rows_affected?: never;
};

type SuccessResult<T> = T[] | boolean;

type QueryResult<T> = QuerySuccess<T> | ErrorQuerying;

type ExecuteResult = ExecuteSuccess | ErrorQuerying;

type Result<T> = QueryResult<T> | ExecuteResult<T>;

type SQLResponse<T> = {
	results: Result<T>[];
};
