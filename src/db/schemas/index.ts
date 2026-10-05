import type { EntityBase, SoftDeletableEntity } from "@/db/schemas/entity-base";

export namespace Schema {
  export interface User extends EntityBase {
    name: string | null;
    email: string;
    email_verified_at: string | null;
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
    organization_id: NonEmptyString | null;
    icon: string;
    created_by_user_id: NonEmptyString | null;
  }
  export interface Workspaces extends Workspace {}

  export interface Organization extends EntityBase {
    name: string;
    data: Record<string, unknown>;
    owner_id: NonEmptyString | null;
  }

  export interface OrganizationMember extends EntityBase {
    organization_id: NonEmptyString;
    user_id: NonEmptyString;
    organization_member_role_id: NonEmptyString | null;
    deleted_at: string | null;
  }

  /** ID de uma role editável; não existe enum de nomes de papéis. */
  export type WorkspaceRole = string;

  export interface WorkspaceMember extends EntityBase {
    workspace_id: NonEmptyString;
    user_id: NonEmptyString;
    workspace_member_role_id: NonEmptyString | null;
    page_root_id: NonEmptyString;
    deleted_at: string | null;
  }

  // --- 3. PAGES ---
  export interface Page extends EntityBase, SoftDeletableEntity {
    /** Internal query projection; omitted from public page responses. */
    title_search?: string | null;
    projection_version?: number;
    dataset_revision?: number;
    title: string | null;
    data: Record<string, unknown>;
    owner_id: NonEmptyString; // ID do usuário dono (ULID)
  }
  export interface Pages extends Page {}

  export interface PageFormPublication extends EntityBase {
    page_id: NonEmptyString;
    view_id: NonEmptyString;
    created_by_user_id: NonEmptyString;
    submit_token_hash: string;
    submit_token_hint: string;
    review_token_hash: string;
    review_token_hint: string;
    expires_at: string | null;
    revoked_at: string | null;
  }

  export interface PageFormSubmission extends EntityBase {
    publication_id: NonEmptyString;
    response_page_id: NonEmptyString;
    client_request_id: string;
    payload_hash: string;
    flow_execution_id: NonEmptyString;
  }

  export interface PageDocument extends EntityBase {
    page_id: NonEmptyString;
    content: Record<string, unknown>;
    revision: number;
  }

  // --- 4. PAGE EDGES (Hierarquia/Conexões de Páginas) ---
  // Aresta pai->filho entre pages. Convenção parent/child (antes page_root_id/
  // page_id) pensada para contextos futuros (árvore/breadcrumb).
  export interface PageEdge extends EntityBase {
    parent_id: NonEmptyString;    // ID da página pai (raiz/workspace no nível 0)
    child_id: NonEmptyString;     // ID da página filha
  }
  export interface PageEdges extends PageEdge {}

  // --- 5. PAGE COLUMNS (Configurações de Colunas) ---
  export type ColumnType = 'text' | 'numeric' | 'select' | 'date' | 'checkbox' | 'flow';

  export type FlowSwitchOperator =
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'is_empty'
    | 'is_not_empty';

  /** Documento legado v1, mantido para execução e conversão compatíveis. */
  export interface FlowStartNode {
    id: string;
    type: 'start';
    config: { nextNodeId: string };
  }

  export interface FlowEmailNode {
    id: string;
    type: 'email';
    config: {
      /** Deve resolver para um macro exato `@people.<userId>.email`. */
      to: string;
      subject: string;
      body: string;
      nextNodeId: string;
    };
  }

  export interface FlowSetValueNode {
    id: string;
    type: 'set_value';
    config: { columnId: NonEmptyString; value: unknown; nextNodeId: string };
  }

  export interface FlowSwitchNode {
    id: string;
    type: 'switch';
    config: {
      left: string;
      operator: FlowSwitchOperator;
      right?: unknown;
      trueTargetId: string;
      falseTargetId: string;
    };
  }

  export interface FlowCallbackNode {
    id: string;
    type: 'callback';
    config: { message?: string };
  }

  export type FlowNode =
    | FlowStartNode
    | FlowEmailNode
    | FlowSetValueNode
    | FlowSwitchNode
    | FlowCallbackNode;

  export interface FlowDefinitionV1 {
    version: 1;
    trigger: { type: 'manual' };
    nodes: FlowNode[];
  }

  export interface FlowStartNodeV2 {
    id: string;
    type: 'start';
    config: Record<string, never>;
  }

  export interface FlowEmailStepV2 {
    id: string;
    type: 'email';
    config: { to: string; subject: string; body: string };
  }

  export interface FlowSetValueStepV2 {
    id: string;
    type: 'set_value';
    config: { columnId: NonEmptyString; value: unknown };
  }

  export interface FlowSwitchStepV2 {
    id: string;
    type: 'switch';
    config: {
      /** `page_title` representa a coluna sintética da página/row. */
      columnId: string;
      operator: FlowSwitchOperator;
      value?: unknown;
      whenTrue: FlowStepV2[];
      whenFalse: FlowStepV2[];
    };
  }

  export type FlowStepV2 = FlowEmailStepV2 | FlowSetValueStepV2 | FlowSwitchStepV2;

  export interface FlowCallbackNodeV2 {
    id: string;
    type: 'callback';
    config: { message?: string };
  }

  export type FlowNodeV2 = FlowStartNodeV2 | FlowStepV2 | FlowCallbackNodeV2;

  export interface FlowDefinitionV2 {
    version: 2;
    trigger: { type: 'manual' };
    /** Start e callback são únicos e fixos na raiz; os steps podem aninhar switches. */
    nodes: FlowNodeV2[];
  }

  export type FlowDefinition = FlowDefinitionV1 | FlowDefinitionV2;

  export interface FlowExecutionSummary {
    executionId: NonEmptyString;
    status: 'succeeded' | 'failed';
    startedAt: string;
    finishedAt: string;
    executedNodeIds: string[];
    callback: string | null;
    effects: { emailsQueued: number; valuesUpdated: number };
    error?: string;
  }

  export type MacroKind = 'page' | 'workspace' | 'column' | 'person';
  export interface MacroDescriptor {
    key: string;
    label: string;
    kind: MacroKind;
    valueType: 'text' | 'number' | 'boolean' | 'date' | 'email' | 'unknown';
    columnId?: NonEmptyString;
    userId?: NonEmptyString;
    preview?: string | null;
  }

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

  /**
   * Identidade legivel usada somente na fronteira publica (URL). O id ULID
   * continua sendo a identidade canonica persistida nos filtros. `aliases`
   * mantem links antigos validos depois de um rename.
   */
  export interface PublicKeyMetadata {
    key: string;
    aliases: string[];
  }

  // Uma opção de coluna `select`, persistida em page_columns.data.options.
  export interface SelectOption {
    id: NonEmptyString;    // ULID (gerado no backend)
    value: string;
    color?: ColorOptions;  // opcional: option pode não ter cor (sem default)
    /** Ausente apenas em dados legados; reconcile/create sempre materializam. */
    publicKey?: PublicKeyMetadata;
  }

  // Formato de exibição de uma coluna `numeric` (só armazenado; parse é posterior).
  export type NumberFormat = 'percentage' | 'currency';

  // Moeda de uma coluna `numeric` com format `currency`. Espelha o CurrencyCode
  // do front (cubs-components/lib/masks.ts). Por ora só BRL; ampliar exige
  // registrar a moeda LÁ (formatter Intl) e aqui.
  export type CurrencyCode = 'BRL';

  // Máscara de uma coluna `text`. Espelha as máscaras de PATTERN do front
  // (applyMask); percentage/currency são de numeric, não entram aqui.
  export type TextMask = 'cpf' | 'cep' | 'phone-br' | 'date' | 'email';

  /**
   * Config da coluna (page_columns.data) — por tipo:
   *  - select  -> `options`
   *  - numeric -> `format` (+ `currency` quando `format = currency`)
   *  - text    -> `mask`
   *
   * IMPORTANTE: o `data` ACUMULA o config de vários tipos de propósito. Trocar o
   * tipo da coluna NÃO apaga o config do tipo anterior (ex.: `text→numeric`
   * preserva o `mask`), para que reverter o tipo restaure tudo. A limpeza só
   * acontece no "reset de tipos" (destrutivo, explícito). A mesclagem vive em
   * PageColumnConfigurationService e a limpeza explícita na rota /reset.
   */
  export interface PageColumnData {
    flowButton?: { label: string | null; icon: string };
    options?: SelectOption[];
    format?: NumberFormat;
    currency?: CurrencyCode;
    mask?: TextMask;
    /** Ausente apenas em dados legados; reconcile/create sempre materializam. */
    publicKey?: PublicKeyMetadata;
    /** Tombstones internos: impedem que links de options excluídas mudem de alvo. */
    reservedOptionKeys?: string[];
    /** Contrato autoritativo do Flow Cards. Configurado apenas pela rota de flow. */
    flow?: FlowDefinition;
  }

  export interface PageColumn extends EntityBase, SoftDeletableEntity {
    name: string | null;
    type: ColumnType;
    data: PageColumnData;
    parent_id: NonEmptyString | null; // página parent dona da coluna (antes page_root_id)
  }
  export interface PageColumns extends PageColumn {}

  // --- 6. PAGE COLUMNS VALUES (Valores das Colunas) ---
  export interface PageColumnValue extends EntityBase {
    search_text?: string | null;
    number_value?: number | null;
    select_option_id?: string | null;
    checkbox_value?: number | null;
    date_start_ms?: number | null;
    date_end_ms?: number | null;
    value_kind?: string;
    projection_version?: number;
    /** Envelope JSON ainda serializado; somente o codec o transforma em valor. */
    data: string;
    page_column_id: NonEmptyString | null;
    page_id: NonEmptyString | null;
  }
  export interface PageColumnsValues extends PageColumnValue {}

  // --- 7. SCHEDULE PINS ---
  export interface PinnedSchedulePage extends EntityBase {
    workspace_id: NonEmptyString;
    page_id: NonEmptyString;
    pinned_by_user_id: NonEmptyString;
    date_column_id: NonEmptyString;
    color_column_id: NonEmptyString | null;
  }

  export type NotificationType = 'schedule_pin_request' | 'schedule_event_reminder' | 'flow_email';
  export type NotificationResourceType = 'schedule_pin_request' | 'page' | 'flow_execution';

  export interface Notification extends EntityBase {
    workspace_id: NonEmptyString;
    recipient_user_id: NonEmptyString | null;
    actor_user_id: NonEmptyString | null;
    type: NotificationType;
    resource_type: NotificationResourceType;
    resource_id: NonEmptyString;
    data: Record<string, unknown>;
    dedupe_key: string;
    read_at: string | null;
  }

  export type NotificationDeliveryStatus = 'pending' | 'processing' | 'sent' | 'failed';
  export interface NotificationDelivery extends EntityBase {
    notification_id: NonEmptyString;
    channel: 'email';
    status: NotificationDeliveryStatus;
    attempts: number;
    payload: Record<string, unknown>;
    next_attempt_at: string | null;
    locked_at: string | null;
    sent_at: string | null;
    provider_message_id: string | null;
    last_error: string | null;
  }

  export type SchedulePinRequestStatus = 'pending' | 'accepted' | 'declined' | 'canceled';
  export interface SchedulePinRequest extends EntityBase {
    workspace_id: NonEmptyString;
    page_id: NonEmptyString;
    requested_by_user_id: NonEmptyString;
    recipient_user_id: NonEmptyString;
    date_column_id: NonEmptyString;
    color_column_id: NonEmptyString | null;
    status: SchedulePinRequestStatus;
    decided_at: string | null;
  }

  // --- 8. PAGE COLLABORATORS (Colaboradores/Acesso de Página) ---
  // Vínculo N:N entre páginas e usuários com acesso àquela página (além do
  // owner_id da própria pages). UNIQUE(page_id, user_id) no banco.
  export interface PageCollaborator extends EntityBase {
    page_id: NonEmptyString;   // ID da página
    user_id: NonEmptyString;   // ID do usuário-colaborador
    page_member_role_id: NonEmptyString | null;
    deleted_at: string | null;
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

  // --- FILTERS V2 (persistidos dentro de pages.data[viewId].filters) ---
  export type ViewFilterCondition =
    | 'equals'
    | 'contains'
    | 'greaterThan'
    | 'lessThan'
    | 'between';

  export interface ViewFilterClause {
    /** `page_title` e a unica identidade sintetica; as demais sao ULIDs. */
    columnId: string;
    condition: ViewFilterCondition;
    /** Select guarda ids de options; os demais tipos guardam valores crus. */
    values: string[];
  }

  export interface ViewFiltersV2 {
    version: 2;
    /** Sempre carimbado pelo servidor em writes; legado reconciliado pode ser null. */
    updatedAt: string | null;
    clauses: ViewFilterClause[];
    /** ULIDs de coluna (ou `page_title`) em ordem de prioridade. */
    groupBy: string[];
    /** Pares desconhecidos preservados em ordem, inclusive chaves repetidas. */
    passthrough: [string, string][];
  }
}
