import mentions, { MentionStore } from '@/repositories/mention-repository';
import { isJsonRecord, isUlid } from '@/services/pages/views/page-view-parsers';
import { isMentionId, type MentionScope } from '@/services/mentions/template';

export function parseMentionScope(input: unknown): MentionScope | null {
  if (!isJsonRecord(input) || Object.keys(input).some((key) => !['pageId', 'workspaceId', 'organizationId'].includes(key))) return null;
  const scope: MentionScope = {};
  for (const key of ['pageId', 'workspaceId', 'organizationId'] as const) {
    if (input[key] !== undefined) {
      if (!isUlid(input[key])) return null;
      scope[key] = input[key] as string;
    }
  }
  return scope;
}
export class MentionController {
  constructor(private readonly store: MentionStore = mentions) {}
  async catalog(actor: string, input: unknown) {
    const scope = parseMentionScope(input);
    if (!scope) return { status: 400, data: { message: 'Contexto de menções inválido' } };
    try { return { status: 200, data: await this.store.catalog(actor, scope) }; }
    catch { return { status: 500, data: { message: 'Não foi possível carregar as menções' } }; }
  }
  async resolve(actor: string, body: unknown) {
    if (!isJsonRecord(body) || Object.keys(body).some((key) => !['scope', 'ids'].includes(key))) return { status: 400, data: { message: 'Menções inválidas' } };
    const scope = parseMentionScope(body.scope);
    if (!scope || !Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some((id) => typeof id !== 'string' || !isMentionId(id))) {
      return { status: 400, data: { message: 'Menções inválidas' } };
    }
    try { return { status: 200, data: await this.store.resolve(actor, scope, [...new Set(body.ids as string[])]) }; }
    catch { return { status: 500, data: { message: 'Não foi possível resolver as menções' } }; }
  }
}
export default new MentionController();
