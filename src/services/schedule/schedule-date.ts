export interface ScheduleInterval {
  start: string;
  end?: string;
  allDay: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT_ISO = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.toISOString().slice(0, 10) === value;
}

function validInstant(value: string): boolean {
  if (!ISO_INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function instant(value: string): Date {
  return new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
}

function addUtcDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function projectScheduleInterval(raw: string): ScheduleInterval | null {
  const parts = raw.includes('@') ? raw.split('@') : [raw];
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return null;
  const start = parts[0];
  const inclusiveEnd = parts[1];
  if (
    (!validDateOnly(start) && !validInstant(start))
    || (inclusiveEnd !== undefined && !validDateOnly(inclusiveEnd) && !validInstant(inclusiveEnd))
  ) return null;
  const isAllDayPart = (value: string) => validDateOnly(value)
    || (MIDNIGHT_ISO.test(value) && validInstant(value));
  const allDay = isAllDayPart(start) && (!inclusiveEnd || isAllDayPart(inclusiveEnd));
  const inclusive = inclusiveEnd ?? start;
  const end = allDay
    ? DATE_ONLY.test(inclusive)
      ? addUtcDay(inclusive)
      : `${addUtcDay(inclusive.slice(0, 10))}T00:00:00.000Z`
    : inclusiveEnd;
  if (inclusiveEnd && instant(inclusiveEnd).getTime() < instant(start).getTime()) return null;
  return { start, ...(end && { end }), allDay };
}

/** Date-only é uma data civil UTC no codec atual; portanto dispara às 00:00Z. */
export function scheduleStartInstant(raw: string): Date | null {
  const parts = raw.includes('@') ? raw.split('@') : [raw];
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return null;
  const start = parts[0];
  if (!validDateOnly(start) && !validInstant(start)) return null;
  return instant(start);
}
