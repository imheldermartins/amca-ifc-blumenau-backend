import {MappedSuperclass,Column,PrimaryKey,Generated,CreatedAt,UpdatedAt,Check} from '@cubs/rqlite-client/schema';

@MappedSuperclass()
@Check('length(id) = 26')
export abstract class IdentitySchema {
  @Column() @PrimaryKey() @Generated('ulid')
  id!: string;
}

@MappedSuperclass()
export abstract class BaseSchema extends IdentitySchema {
  @CreatedAt()
  created_at!: string;

  @UpdatedAt()
  updated_at!: string;
}
