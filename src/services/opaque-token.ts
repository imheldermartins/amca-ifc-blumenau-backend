import { createHash, randomBytes } from 'node:crypto';

export type OpaqueTokenPrefix =
  | 'cubs_verify_v1_'
  | 'cubs_invite_v1_'
  | 'cubs_form_fill_v1_'
  | 'cubs_form_review_v1_';

export function createOpaqueToken(prefix: OpaqueTokenPrefix) {
  return prefix + randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function opaqueTokenHint(value: string): string {
  return value.slice(0, value.indexOf('_v1_') + 4) + '…' + value.slice(-6);
}

export function isOpaqueToken(value: unknown, prefix: OpaqueTokenPrefix): value is string {
  return typeof value === 'string' && value.startsWith(prefix) && value.length >= prefix.length + 40;
}
