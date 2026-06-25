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

  // --- 4. PAGE HUBS (Hierarquia/Conexões de Páginas) ---
  export interface PageHub extends EntityBase {
    page_root_id: NonEmptyString; // ID da página raiz (workspace)
    page_id: NonEmptyString;      // ID da página filha
  }
  export interface PageHubs extends PageHub {}

  // --- 5. PAGE COLUMNS (Configurações de Colunas) ---
  export type ColumnType = 'text' | 'numeric' | 'select' | 'date' | 'checkbox';

  export interface PageColumn extends EntityBase {
    name: string | null;
    type: ColumnType;
    data: Record<string, unknown>;
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
}
