import { describe, expect, it } from 'vitest';
import { formatDatetimeMention, isMentionId, mentionIds, mentionToken, resolveMentionText } from './template.js';

describe('global datetime mentions', () => {
  it.each([
    ['2026-10-26T15:04:59.123Z', '26/10/2026 às 12:04'],
    ['2026-01-01T01:02:03.004Z', '31/12/2025 às 22:02'],
    ['2026-10-26T03:00:00.000Z', '26/10/2026 às 00:00'],
  ])('formats the stored instant consistently in São Paulo: %s', (id, expected) => {
    expect(formatDatetimeMention(id)).toBe(expected);
    expect(isMentionId(id)).toBe(true);
    expect(mentionIds(`${mentionToken(id)} ${mentionToken(id)}`)).toEqual([id]);
    expect(resolveMentionText(`Em ${mentionToken(id)}`, { [id]: 'hoje' })).toBe(`Em ${expected}`);
  });
  it.each(['hoje', '2026-10-26', '2026-02-30T12:00:00.000Z', '2026-10-26T25:00:00.000Z', '2026-10-26T12:00:00Z'])('rejects incomplete or invalid datetimes: %s', (id) => {
    expect(formatDatetimeMention(id)).toBeNull();
    expect(isMentionId(id)).toBe(false);
    expect(mentionIds(mentionToken(id))).toEqual([]);
  });
});
