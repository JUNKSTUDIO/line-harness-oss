import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fetchIcalEvents } from './business-calendar.js';

const SAMPLE_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:single-event@example.com
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260705
SUMMARY:臨時休業
END:VEVENT
BEGIN:VEVENT
UID:weekly-closure@example.com
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260601
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5
SUMMARY:定休日 (月曜)
END:VEVENT
BEGIN:VEVENT
UID:past-event@example.com
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260101
SUMMARY:過去の予定
END:VEVENT
END:VCALENDAR`;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchIcalEvents', () => {
  test('returns [] when the fetch fails (network error / non-OK)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    const result = await fetchIcalEvents('https://example.com/cal.ics', new Date('2026-06-01'), new Date('2026-06-30'));
    expect(result).toEqual([]);
  });

  test('returns [] when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('boom'));
    const result = await fetchIcalEvents('https://example.com/cal.ics', new Date('2026-06-01'), new Date('2026-06-30'));
    expect(result).toEqual([]);
  });

  test('returns [] when the body is not valid iCal', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => 'not ical at all' } as Response);
    const result = await fetchIcalEvents('https://example.com/cal.ics', new Date('2026-06-01'), new Date('2026-06-30'));
    expect(result).toEqual([]);
  });

  test('extracts a single-occurrence event within range and excludes events outside range', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => SAMPLE_ICAL } as Response);
    const result = await fetchIcalEvents(
      'https://example.com/cal.ics',
      new Date('2026-07-01T00:00:00+09:00'),
      new Date('2026-07-31T23:59:59+09:00'),
    );
    expect(result).toEqual([{ date: '2026-07-05', title: '臨時休業' }]);
  });

  test('expands a weekly recurring event into individual occurrence dates within range', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => SAMPLE_ICAL } as Response);
    const result = await fetchIcalEvents(
      'https://example.com/cal.ics',
      new Date('2026-06-01T00:00:00+09:00'),
      new Date('2026-06-30T23:59:59+09:00'),
    );
    const mondays = result.filter((e) => e.title === '定休日 (月曜)').map((e) => e.date);
    // 2026-06-01起点のWeekly RRULE COUNT=5: 6/1, 6/8, 6/15, 6/22, 6/29 の5件すべてが6月内に収まる
    expect(mondays).toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
  });

  test('does not include occurrences outside the requested range (past event excluded)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => SAMPLE_ICAL } as Response);
    const result = await fetchIcalEvents(
      'https://example.com/cal.ics',
      new Date('2026-07-01T00:00:00+09:00'),
      new Date('2026-07-31T23:59:59+09:00'),
    );
    expect(result.some((e) => e.title === '過去の予定')).toBe(false);
    expect(result.some((e) => e.title === '定休日 (月曜)')).toBe(false);
  });
});
