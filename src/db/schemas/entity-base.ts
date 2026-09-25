/**
 * @class EntityBase
 * @description  Representa uma entidade base que pode ser estendida por outras entidades no sistema
 * @property {string} id - O identificador único da entidade
 * @property {string} created_at - Timestamp retornado pelo rqlite
 * @property {string} updated_at - Timestamp retornado pelo rqlite
 */
export interface EntityBase {
  id: NonEmptyString;
  created_at: string;
  updated_at: string;
};

/** Entidade cuja remoção é um tombstone temporal, e não um DELETE físico. */
export interface SoftDeletableEntity {
  deleted_at: string | null;
}
