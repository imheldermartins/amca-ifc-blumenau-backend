import type { EntityBase } from "@/models/schemas/entity-base";

export namespace Schema {
  export interface User extends EntityBase {
    name: string | null;
    email: string;
  }
  export interface Users extends User {}

  /**
   * Uso INTERNO (auth). Inclui o hash da senha que vive na coluna
   * users.password_hash e o token_version (o kill switch dos refresh tokens).
   * NUNCA serializar em respostas HTTP -- use o tipo `User` público para isso.
   */
  export interface UserCredentials extends User {
    password_hash: string | null;
    /** Incrementado no logout: invalida todo refresh já emitido para a conta. */
    token_version: number;
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
  }
  export interface PageEdges extends PageEdge {}

  // --- 5. PAGE COLUMNS (Configurações de Colunas) ---
  export type ColumnType = 'text' | 'numeric' | 'select' | 'date' | 'checkbox';

  // Cores aceitas para as opções de uma coluna `select`.
  export const COLOR_OPTIONS = [
    'red',
    'pink',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'grey',
  ] as const;
  export type ColorOptions = (typeof COLOR_OPTIONS)[number];

  // Uma opção de coluna `select`, persistida em page_columns.data.options.
  export interface SelectOption {
    id: NonEmptyString;    // ULID (gerado no backend)
    value: string;
    color?: ColorOptions;  // opcional: option pode não ter cor (sem default)
  }

  // Formato de exibição de uma coluna `numeric` (só armazenado; parse é posterior).
  export type NumberFormat = 'percentage' | 'currency';

  // Moeda de uma coluna `numeric` com format `currency`. Espelha o CurrencyCode
  // do front (cubs-components/lib/masks.ts). Por ora só BRL; ampliar exige
  // registrar a moeda LÁ (formatter Intl) e aqui.
  export type CurrencyCode = 'BRL';

  // Máscara de uma coluna `text`. Espelha as máscaras de PATTERN do front
  // (applyMask); percentage/currency são de numeric, não entram aqui.
  export type TextMask = 'cpf' | 'cep' | 'phone-br' | 'date';

  /**
   * Config da coluna (page_columns.data) — por tipo:
   *  - select  -> `options`
   *  - numeric -> `format` (+ `currency` quando `format = currency`)
   *  - text    -> `mask`
   *
   * IMPORTANTE: o `data` ACUMULA o config de vários tipos de propósito. Trocar o
   * tipo da coluna NÃO apaga o config do tipo anterior (ex.: `text→numeric`
   * preserva o `mask`), para que reverter o tipo restaure tudo. A limpeza só
   * acontece no "reset de tipos" (destrutivo, explícito). Ver `buildData` no
   * page-column-controller e a rota /reset.
   */
  export interface PageColumnData {
    options?: SelectOption[];
    format?: NumberFormat;
    currency?: CurrencyCode;
    mask?: TextMask;
  }

  export interface PageColumn extends EntityBase {
    name: string | null;
    type: ColumnType;
    data: PageColumnData;
    parent_id: NonEmptyString | null; // página parent dona da coluna (antes page_root_id)
  }
  export interface PageColumns extends PageColumn {}

  // --- 6. PAGE COLUMNS VALUES (Valores das Colunas) ---
  export interface PageColumnValue extends EntityBase {
    data: Record<string, unknown>;
    page_column_id: NonEmptyString | null;
    page_id: NonEmptyString | null;
  }
  export interface PageColumnsValues extends PageColumnValue {}

  // --- 7. PAGE COLLABORATORS (Colaboradores/Acesso de Página) ---
  // Vínculo N:N entre páginas e usuários com acesso àquela página (além do
  // owner_id da própria pages). UNIQUE(page_id, user_id) no banco.
  export interface PageCollaborator extends EntityBase {
    page_id: NonEmptyString;   // ID da página
    user_id: NonEmptyString;   // ID do usuário-colaborador
  }
  export interface PageCollaborators extends PageCollaborator {}

  // Resumo do usuário devolvido por GET /pages/:id/collaborators (join com
  // `users`): só a identificação, sem o vínculo nem campos sensíveis.
  export interface PageCollaboratorSummary {
    id: NonEmptyString;
    name: string | null;
    email: string;
  }

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
