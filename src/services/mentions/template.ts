/** Portable persisted references. Labels and resolved values never replace these ids. */
export type MentionKind = 'users' | 'pages' | 'workspace' | 'organization';
export interface MentionReference { kind: MentionKind; entityId: string; field: string }
export interface MentionScope { pageId?: string; workspaceId?: string; organizationId?: string }
export interface MentionPerson { id: string; name: string | null; email: string }
export interface MentionCatalog {
  users: MentionPerson[];
  page?: { id: string; title: string | null; columns?: MentionPageColumn[] };
  workspace?: { id: string; name: string | null; data: Record<string, unknown> };
  organization?: { id: string; name: string | null; data: Record<string, unknown> };
}
export interface MentionPageColumn { id: string; name: string; value: string }
export interface MentionOption { id: string; label: string; value: string; section: string; search?: string }
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
export function mentionId(kind: MentionKind, entityId: string, field: string): string {
  return `${kind}:${entityId}:${encodeURIComponent(field)}`;
}
export function parseMentionId(id: string): MentionReference | null {
  const parts = id.split(':');
  if (parts.length !== 3 || !ULID.test(parts[1]!)) return null;
  const kind = parts[0] as MentionKind;
  let field: string;
  try { field = decodeURIComponent(parts[2]!); } catch { return null; }
  const valid = kind === 'users' ? field === 'email' || field === 'name'
    : kind === 'pages' ? field === 'title' || (field.startsWith('columns.') && ULID.test(field.slice(8)))
      : (kind === 'workspace' || kind === 'organization') && (field === 'name' || (field.startsWith('data.') && field.length > 5 && field.length <= 125));
  return valid ? { kind, entityId: parts[1]!, field } : null;
}
export function mentionToken(id: string): string { return `@{${id}}`; }
export function mentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(/@\{([^{}]{1,1600})\}/g)].map((match) => match[1]!).filter((id) => parseMentionId(id)))];
}
/** Resolver outputs are already expanded server-side; inserted values remain literal. */
export function resolveMentionText(text: string, values: Readonly<Record<string, string | null>>, unavailable = ''): string {
  return text.replace(/@\{([^{}]{1,1600})\}/g, (token, id: string) => parseMentionId(id) ? values[id] ?? unavailable : token);
}
