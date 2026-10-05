import {Check,Column,ForeignKey,Index,Table,Unique} from '@cubs/rqlite-client/schema';
import {BaseSchema} from './Base.schema.js';

/** Ledger mínimo de idempotência e revisão; as respostas vivem na row/células. */
@Table('page_form_submissions')
@Check("length(payload_hash) = 64")
@ForeignKey({"columns":["publication_id"],"table":"page_form_publications","references":["id"]})
@ForeignKey({"columns":["response_page_id"],"table":"pages","references":["id"]})
@Unique(["publication_id","client_request_id"])
@Unique(["response_page_id"])
@Index("idx_page_form_submissions_publication_created", ["publication_id","created_at","id"])
export class PageFormSubmissionSchema extends BaseSchema {
  @Column()
  publication_id!: string;

  @Column()
  response_page_id!: string;

  @Column()
  client_request_id!: string;

  @Column()
  payload_hash!: string;

  @Column()
  flow_execution_id!: string;
}
