import { describe, expect, it } from 'vitest';

import { projectScheduleInterval, scheduleStartInstant } from './schedule-date.js';

describe('schedule date projection', () => {
  it('projects civil dates and inclusive ranges as all-day exclusive intervals', () => {
    expect(projectScheduleInterval('2026-10-01')).toEqual({
      start: '2026-10-01',
      end: '2026-10-02',
      allDay: true,
    });
    expect(projectScheduleInterval('2026-10-01@2026-10-03')).toEqual({
      start: '2026-10-01',
      end: '2026-10-04',
      allDay: true,
    });
    expect(scheduleStartInstant('2026-10-01')?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('preserves timed instants and rejects malformed or inverted values', () => {
    const start = '2026-10-01T13:45:00.000Z';
    const end = '2026-10-01T14:30:00.000Z';
    expect(projectScheduleInterval(`${start}@${end}`)).toEqual({ start, end, allDay: false });
    expect(scheduleStartInstant(`${start}@${end}`)?.toISOString()).toBe(start);
    expect(projectScheduleInterval(`${end}@${start}`)).toBeNull();
    expect(scheduleStartInstant('amanhã')).toBeNull();
  });
});
