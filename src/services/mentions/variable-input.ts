import { isJsonRecord } from '@/services/pages/views/page-view-parsers';

export function parseVariableInput(body: unknown): { key: string; value: string | null } | null {
  if (!isJsonRecord(body) || Object.keys(body).some((key) => !['key', 'value'].includes(key))
    || typeof body.key !== 'string' || !body.key.trim() || body.key.trim().length > 120
    || ['__proto__', 'constructor', 'prototype'].includes(body.key.trim())
    || (body.value !== null && (typeof body.value !== 'string' || body.value.length > 10_000))) return null;
  return { key: body.key.trim(), value: body.value };
}
