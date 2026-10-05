import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const runtimeSecret = randomBytes(32);
export class PageViewQueryError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string, public readonly code?: string) { super(message); }
}
export interface QueryCursorContext { queryKey: string; userId: string; datasetRevision: number; orderRevision: number; scopeKey: string }
export interface QueryCursorPosition { rank: string; id: string }
interface CursorDocument extends QueryCursorContext, QueryCursorPosition { version: 1; purpose: 'rows' | 'groups' }
export function queryFingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('base64url'); }

/** An opaque signed position, never an offset or an authorization grant. */
export class PageViewQueryCursor {
  constructor(private readonly secret: string | Uint8Array = process.env.JWT_ACCESS_SECRET ?? runtimeSecret) {}
  encode(context: QueryCursorContext, position: QueryCursorPosition, purpose: CursorDocument['purpose'] = 'rows'): string {
    const body = Buffer.from(JSON.stringify({ ...context, ...position, version: 1, purpose })).toString('base64url');
    return `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
  }
  decode(token: string, context: QueryCursorContext, purpose: CursorDocument['purpose'] = 'rows'): QueryCursorPosition {
    if (token.length > 4096) throw new PageViewQueryError(400, 'Cursor inválido');
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) throw new PageViewQueryError(400, 'Cursor inválido');
    const expected = createHmac('sha256', this.secret).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new PageViewQueryError(400, 'Cursor inválido');
    let document: CursorDocument;
    try { document = JSON.parse(Buffer.from(body, 'base64url').toString()) as CursorDocument; }
    catch { throw new PageViewQueryError(400, 'Cursor inválido'); }
    if (document.version !== 1 || document.purpose !== purpose || typeof document.rank !== 'string' || typeof document.id !== 'string'
      || document.queryKey !== context.queryKey || document.userId !== context.userId || document.scopeKey !== context.scopeKey) {
      throw new PageViewQueryError(400, 'Cursor incompatível com a consulta');
    }
    if (document.datasetRevision !== context.datasetRevision || document.orderRevision !== context.orderRevision) {
      throw new PageViewQueryError(409, 'A listagem mudou. Atualize a posição da paginação.', 'STALE_CURSOR');
    }
    return { rank: document.rank, id: document.id };
  }
}
