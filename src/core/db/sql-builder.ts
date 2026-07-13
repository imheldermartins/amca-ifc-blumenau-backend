import squel, { type BaseBuilder } from "squel";

/**
 * Monta statements SQL SEMPRE parametrizados (`{ text, values }` via
 * `squel.toParam()`): valores do usuário viram placeholders `?` ligados por
 * bind, nunca são concatenados no texto do SQL. Isso fecha o vetor de SQL
 * injection e, de quebra, resolve valores com aspas simples (ex.: "O'Brien"),
 * que antes quebravam a query.
 *
 * Identificadores (tabela/coluna) NÃO são parametrizáveis por nenhum banco, então
 * entram no texto -- por isso passam por `assertIdentifier` antes. Na prática os
 * nomes vêm do schema (código), não de input do usuário; o guarda é defesa em
 * profundidade.
 */
export class SQLBuilder<T> {
  private tableName: string;
  private sql: BaseBuilder | null = null;

  public constructor(tableName: string) {
    this.assertIdentifier(tableName);
    this.tableName = tableName;
  }

  private sqlError(message: string): never {
    throw new Error(message, { cause: 'SQLERROR-MALFORMED' });
  }

  // Só aceita [A-Za-z0-9_] como nome de tabela/coluna. Bloqueia injeção via
  // identificador (que o bind de valores não cobre).
  private assertIdentifier(name: string): void {
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
      this.sqlError(`Identificador SQL inválido: "${name}"`);
    }
  }

  /**
   * Valor pronto para bind (`?`). Objetos/arrays viram JSON string (as colunas
   * JSON do SQLite/rqlite guardam TEXTO); null/undefined viram null. NÃO faz
   * quoting -- o valor viaja como parâmetro, jamais concatenado no SQL.
   */
  private toParamValue(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return JSON.stringify(value);
    return value as string | number | boolean;
  }

  // `%` numa string vira LIKE; caso contrário, igualdade exata. O valor segue
  // como bind nos dois casos, então `%` não é um risco.
  private conditionOperator(value: unknown): "LIKE" | "=" {
    return typeof value === "string" && value.includes("%") ? "LIKE" : "=";
  }

  /**
   * Aplica um grupo de condições (`where.and` / `where.or`) como UMA cláusula
   * parametrizada: `k1 op ? <joiner> k2 op ?`, com os valores ligados por bind.
   */
  private applyGroup(group: Partial<T> | undefined, joiner: "and" | "or"): void {
    const entries = Object.entries(group ?? {});
    if (entries.length === 0) return;

    const parts: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of entries) {
      this.assertIdentifier(key);
      parts.push(`${key} ${this.conditionOperator(value)} ?`);
      values.push(this.toParamValue(value));
    }

    this.sql?.where(parts.join(` ${joiner} `), ...values);
  }

  private toStatement(): SqlStatement {
    if (!this.sql) this.sqlError("SQL is not defined.");
    const { text, values } = this.sql.toParam();
    return { text, values };
  }

  public create(data: CreateValues<T>): SqlStatement {
    this.sql = squel.insert().into(this.tableName);

    const entries = Object.entries(data);
    if (entries.length === 0) this.sqlError("Entries is empty. There is no values to create.");

    entries.forEach(([key, value]) => {
      this.assertIdentifier(key);
      this.sql?.set(key, this.toParamValue(value));
    });

    return this.toStatement();
  }

  public read(lookup?: LookupsConfig<T>): SqlStatement {
    this.sql = squel.select().from(this.tableName);

    if (lookup) {
      const { where, limit, ...direct } = lookup as LookupsConfig<T> & Record<string, unknown>;

      // Filtros diretos (Partial<T>): cada `key = ?` é ANDado (uma call por chave).
      for (const [key, value] of Object.entries(direct)) {
        this.assertIdentifier(key);
        this.sql.where(`${key} = ?`, this.toParamValue(value));
      }

      // where.and / where.or: cada um vira um grupo parametrizado único.
      this.applyGroup(where?.and, "and");
      this.applyGroup(where?.or, "or");

      if (limit) this.sql.limit(limit);
    }

    return this.toStatement();
  }

  public update(values: UpdateValues<T>, lookup: LookupValues<T>): SqlStatement {
    this.sql = squel.update().table(this.tableName);

    const valueEntries = Object.entries(values ?? {});
    if (valueEntries.length === 0) this.sqlError("Entries is empty. There is no values to update.");

    const lookupEntries = Object.entries(lookup ?? {});
    if (lookupEntries.length === 0) this.sqlError("Missing lookup. Update requires at least one criterion.");

    valueEntries.forEach(([key, value]) => {
      this.assertIdentifier(key);
      this.sql?.set(key, this.toParamValue(value));
    });

    lookupEntries.forEach(([key, value]) => {
      this.assertIdentifier(key);
      this.sql?.where(`${key} = ?`, this.toParamValue(value));
    });

    return this.toStatement();
  }

  public delete(lookup: LookupValues<T>): SqlStatement {
    this.sql = squel.delete().from(this.tableName);

    const entries = Object.entries(lookup);
    if (entries.length === 0) this.sqlError('Missing Parameters');

    entries.forEach(([key, value]) => {
      this.assertIdentifier(key);
      this.sql?.where(`${key} = ?`, this.toParamValue(value));
    });

    return this.toStatement();
  }
}
