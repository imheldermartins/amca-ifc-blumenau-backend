export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function isUlid(value: unknown): value is NonEmptyString {
  return typeof value === "string" && ULID_RE.test(value);
}
