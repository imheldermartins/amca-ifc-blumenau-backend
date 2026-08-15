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
};

type SuccessResult<T> = T[] | boolean;

type QueryResult<T> = QuerySuccess<T> | ErrorQuerying;

type ExecuteResult = ExecuteSuccess | ErrorQuerying;

type Result<T> = QueryResult<T> | ExecuteResult<T>;

type SQLResponse<T> = {
	results: Result<T>[];
};
