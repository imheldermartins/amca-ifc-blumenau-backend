import {Check,Column,Default,ForeignKey,Index,Table,Unique} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

/**
 * Publicação de uma view `form`.
 *
 * As capabilities nunca são persistidas em claro: somente SHA-256 + um hint
 * não autenticador para a tela de administração.
 */
@Table('page_form_publications')
@Check("length(submit_token_hash) = 64")
@Check("length(review_token_hash) = 64")
@ForeignKey({"columns":["page_id"],"table":"pages","references":["id"]})
@ForeignKey({"columns":["created_by_user_id"],"table":"users","references":["id"]})
@Unique(["page_id","view_id"])
@Unique(["submit_token_hash"])
@Unique(["review_token_hash"])
@Index("idx_page_form_publications_page_view", ["page_id","view_id"])
export class PageFormPublicationSchema extends BaseSchema {
  @Column()
  page_id!: string;

  @Column()
  view_id!: string;

  @Column()
  created_by_user_id!: string;

  @Column()
  submit_token_hash!: string;

  @Column()
  submit_token_hint!: string;

  @Column()
  review_token_hash!: string;

  @Column()
  review_token_hint!: string;

  @Column() @Default(null)
  expires_at!: string | null;

  @Column() @Default(null)
  revoked_at!: string | null;
}
