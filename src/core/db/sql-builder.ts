import squel, { type BaseBuilder } from "squel";

export class SQLBuilder<T> {
  private tableName: string;
  private sql: BaseBuilder | null = null;

  public constructor(tableName: string) {
    this.tableName = tableName;
  }

  private sqlError(message: string): never {
    throw new Error(message, { cause: 'SQLERROR-MALFORMED' });
  }

  /**
   * Valor pronto para `squel.set()`. Objetos/arrays viram JSON string -- as
   * colunas JSON do SQLite/rqlite armazenam TEXTO, e o squel só aceita
   * string/number/boolean/null. (`typeof null === 'object'`, por isso o guarda
   * explícito de null.)
   */
  private toSetValue(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return JSON.stringify(value);
    return value as string | number | boolean;
  }

  /**
   * Literal SQL para cláusulas WHERE montadas à mão (read/update/delete).
   * Objetos viram JSON string entre aspas; strings ganham aspas; o resto entra
   * cru. Mantém a mesma serialização do `toSetValue`, então um lookup por uma
   * coluna JSON casa com o valor gravado.
   */
  private toWhereLiteral(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return `'${JSON.stringify(value)}'`;
    if (typeof value === "string") return `'${value}'`;
    return value as number | boolean;
  }

  private prepareLookupEntries(conditionals: LookupWhere<T>) {
    Object.entries(conditionals).forEach(([cKey, cValue]) => {
      const filters = Object.entries(cValue ?? {}).map(([key, value]) => {
        const lookupIsString = typeof value === "string";
        const lookupSearch =
          lookupIsString && value.includes("%") ? "LIKE" : "=";

        return `${key} ${lookupSearch} ${this.toWhereLiteral(value)}`;
      });

      this.sql?.where(`${filters.join(` ${cKey} `)}`);
    });
  }

  public raw(): string {
    if (!this.sql) this.sqlError("SQL is not defined.");
    return String(this.sql?.toString());
  }

  public create(data: CreateValues<T>): string {
    this.sql = squel.insert().into(this.tableName);

    const entries = Object.entries(data);
    if (entries.length === 0) this.sqlError("Entries is empty. There is no values to create.");

    try {
      entries.forEach(([key, value]) => {
        this.sql?.set(key, this.toSetValue(value));
      });
      return String(this.sql?.toString());
    } catch (err) {
      this.sqlError(`Falha ao montar INSERT em "${this.tableName}": ${(err as Error).message}`);
    }
  }

  public read(lookup?: LookupsConfig<T>): string {
    this.sql = squel.select().from(this.tableName);

    if (lookup && Object.keys(lookup).filter(key => !(['where', 'limit'].includes(key))).length > 0) {

      const tempLookup = { ...lookup };
      if ('where' in tempLookup) delete tempLookup.where;
      if ('limit' in tempLookup) delete tempLookup.limit;

      Object.entries(tempLookup).forEach(([key, value]) => {
        this.sql.where(`${key} = ${this.toWhereLiteral(value)}`);
      });
    }

    this.prepareLookupEntries(lookup?.where ?? {});

    if (lookup?.limit) this.sql.limit(lookup.limit);

    return String(this.sql?.toString());
  }

  public update(values: UpdateValues<T>, lookup: LookupValues<T>): string {
    this.sql = squel.update().table(this.tableName);

    const valueEntries = Object.entries(values ?? {});
    if (valueEntries.length === 0) this.sqlError("Entries is empty. There is no values to update.");

    const lookupEntries = Object.entries(lookup ?? {});
    if (lookupEntries.length === 0) this.sqlError("Missing lookup. Update requires at least one criterion.");

    try {
      valueEntries.forEach(([key, value]) => {
        this.sql?.set(key, this.toSetValue(value));
      });

      lookupEntries.forEach(([key, value]) => {
        this.sql?.where(`${key} = ${this.toWhereLiteral(value)}`);
      });

      return String(this.sql?.toString());
    } catch (err) {
      this.sqlError(`Falha ao montar UPDATE em "${this.tableName}": ${(err as Error).message}`);
    }
  }

  public delete(lookup: LookupValues<T>): string {
    this.sql = squel.delete().from(this.tableName);

    const entries = Object.entries(lookup);
    if (entries.length === 0) this.sqlError('Missing Parameters');

    entries.forEach(([key, value]) => {
      this.sql.where(`${key} = ${this.toWhereLiteral(value)}`);
    });

    return String(this.sql?.toString());
  }
}