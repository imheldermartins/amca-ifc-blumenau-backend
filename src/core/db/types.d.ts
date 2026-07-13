/**
 * Statement pronto para o rqlite, PARAMETRIZADO: `text` com placeholders `?` e
 * `values` com os valores ligados (bind). É o formato que o SQLBuilder produz
 * e o Model repassa -- nenhum valor de usuário é concatenado no SQL (defesa
 * contra SQL injection). Equivale ao `ParamString` do squel.
 */
type SqlStatement = { text: string; values: unknown[] };

/**
 * Formato aceito pelo endpoint do rqlite: uma string SQL simples OU um array
 * `[sql, ...params]` para statement parametrizado.
 */
type RqliteStatement = string | unknown[];

type AutoManagedFields = 'id' | 'created_at' | 'updated_at';

type CreateValues<T> = Omit<T, AutoManagedFields>;

type UpdateValues<T> = Partial<Omit<T, AutoManagedFields>>;

type LookupValues<T> = AtLeastOne<T>;

type LookupWhere<T> = {
  and?: Partial<T>;
  or?: Partial<T>;
};

type LookupsConfig<T> = {
  where?: LookupWhere<T>;
  limit?: number;
} & Partial<T>;