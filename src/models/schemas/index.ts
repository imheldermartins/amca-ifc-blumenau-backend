import type { EntityBase } from "@/models/schemas/entity-base";

export namespace Schema {
  export interface User extends EntityBase {
    name: string | null;
    email: string;
  }
  export interface Users extends User {}

  /**
   * Uso INTERNO (auth). Inclui o hash da senha que vive na coluna users.password_hash.
   * NUNCA serializar em respostas HTTP -- use o tipo `User` público para isso.
   */
  export interface UserCredentials extends User {
    password_hash: string | null;
  }

  // --- 2. WORKSPACES ---
  export interface Workspace extends EntityBase {
    name: string | null;
    data: Record<string, unknown>;
  }
  export interface Workspaces extends Workspace {}

  // --- 3. PAGES ---
  export interface Page extends EntityBase {
    title: string | null;
    data: Record<string, unknown>;
    owner_id: NonEmptyString; // ID do usuário dono (ULID)
  }
  export interface Pages extends Page {}

  // --- 4. PAGE EDGES (Hierarquia/Conexões de Páginas) ---
  // Aresta pai->filho entre pages. Convenção parent/child (antes page_root_id/
  // page_id) pensada para contextos futuros (árvore/breadcrumb).
  export interface PageEdge extends EntityBase {
    parent_id: NonEmptyString;    // ID da página pai (raiz/workspace no nível 0)
    child_id: NonEmptyString;     // ID da página filha
    slug: string | null;          // segmento de caminho da filha (breadcrumb)
  }
  export interface PageEdges extends PageEdge {}

  // --- 5. PAGE COLUMNS (Configurações de Colunas) ---
  export type ColumnType = 'text' | 'numeric' | 'select' | 'date' | 'checkbox';

  // Cores aceitas para as opções de uma coluna `select`.
  export type ColorOptions = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'grey';

  // Uma opção de coluna `select`, persistida em page_columns.data.options.
  export interface SelectOption {
    id: NonEmptyString;    // ULID (gerado no backend)
    value: string;
    color?: ColorOptions;  // opcional: option pode não ter cor (sem default)
  }

  // Formato de exibição de uma coluna `numeric` (só armazenado; parse é posterior).
  export type NumberFormat = 'percentage' | 'currency';

  // Config da coluna (page_columns.data): `options` (select) / `format` (numeric).
  export interface PageColumnData {
    options?: SelectOption[];
    format?: NumberFormat;
  }

  export interface PageColumn extends EntityBase {
    name: string | null;
    type: ColumnType;
    data: PageColumnData;
    page_root_id: NonEmptyString | null;
  }
  export interface PageColumns extends PageColumn {}

  // --- 6. PAGE COLUMNS VALUES (Valores das Colunas) ---
  export interface PageColumnValue extends EntityBase {
    data: Record<string, unknown>;
    page_column_id: NonEmptyString | null;
    page_id: NonEmptyString | null;
  }
  export interface PageColumnsValues extends PageColumnValue {}

  // Envelope persistido em page_columns_values.data: SEMPRE { value: <T> }.
  export interface ColumnValueEnvelope<T = unknown> {
    value: T;
  }

  // Valor entregue ao cliente HTTP: sem envelope, sem string JSON crua.
  export interface DecodedColumnValue<T = unknown> {
    id: NonEmptyString;
    page_id: NonEmptyString | null;
    page_column_id: NonEmptyString | null;
    type: ColumnType;
    value: T;
  }

  // Contrato do codec: ponte entre o valor "nu" do cliente <-> envelope gravado.
  // `validate` LANÇA em entrada inválida (ver VALUE_CODECS em services/value-codec).
  export interface ColumnValueCodec<T = unknown> {
    validate(rawValue: unknown, column: PageColumn): T;
    encode(value: T): string;
    decode(data: string): T;
  }
}
