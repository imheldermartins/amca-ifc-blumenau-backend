/**
 * @class EntityBase
 * @description  Representa uma entidade base que pode ser estendida por outras entidades no sistema
 * @property {string} id - O identificador único da entidade
 * @property {Date} createdAt - A data de criação da entidade
 * @property {Date} updatedAt - A data da última atualização da entidade
 */
export interface EntityBase {
  id: NonEmptyString;
  created_at: Date;
  updated_at: Date;
};

/** Entidade cuja remoção é um tombstone temporal, e não um DELETE físico. */
export interface SoftDeletableEntity {
  deleted_at: Date | null;
}
