// 営業日カレンダー — 管理画面で指定したiCal形式URLから予定を取得する。
// Cloudflareのエッジキャッシュ (cf.cacheTtl) に任せることで、外部URLへの過剰な
// アクセスを避ける (iCalの更新頻度は低いため、天気APIのような独自のDB上の
// 間隔管理は不要)。取得・パースに失敗しても空配列を返し、カレンダー自体
// (クーポン/カード期限の表示) は止めない。

import ICAL from 'ical.js';

export interface BusinessCalendarEvent {
  /** JST基準の日付 (YYYY-MM-DD) */
  date: string;
  title: string;
}

const ICAL_FETCH_CACHE_TTL_SECONDS = 1800; // 30分。iCalの更新頻度は低いため十分な長さ。
const MAX_RECURRENCE_EXPANSIONS = 2000; // UNTIL/COUNT指定なしの無限繰り返し対策の安全弁。

/** UTCのDateインスタンスを、JST基準の日付文字列 (YYYY-MM-DD) に変換する。 */
export function toJstDateString(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  return jst.toISOString().slice(0, 10);
}

function icalTimeToJstDateString(t: InstanceType<typeof ICAL.Time>): string {
  if (t.isDate) {
    // 終日イベント (DTSTART;VALUE=DATE) はタイムゾーン変換が不要・かつ不正確になりやすいため、
    // ICAL.Time が直接持つ year/month/day をそのまま使う。
    const mm = String(t.month).padStart(2, '0');
    const dd = String(t.day).padStart(2, '0');
    return `${t.year}-${mm}-${dd}`;
  }
  return toJstDateString(t.toJSDate());
}

/** 指定期間 [rangeStart, rangeEnd] (両端含む) に該当する予定を、繰り返し予定も展開して返す。 */
export async function fetchIcalEvents(
  icalUrl: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<BusinessCalendarEvent[]> {
  try {
    const res = await fetch(icalUrl, {
      cf: { cacheTtl: ICAL_FETCH_CACHE_TTL_SECONDS, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return [];
    const text = await res.text();
    const jcalData = ICAL.parse(text);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');

    const events: BusinessCalendarEvent[] = [];
    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      const title = event.summary || '(無題の予定)';
      if (event.isRecurring()) {
        const iterator = event.iterator();
        for (let i = 0; i < MAX_RECURRENCE_EXPANSIONS; i++) {
          const next = iterator.next();
          if (!next) break;
          const occurrenceDate = next.toJSDate();
          if (occurrenceDate.getTime() > rangeEnd.getTime()) break;
          if (occurrenceDate.getTime() >= rangeStart.getTime()) {
            events.push({ date: icalTimeToJstDateString(next), title });
          }
        }
      } else {
        const start = event.startDate.toJSDate();
        if (start.getTime() >= rangeStart.getTime() && start.getTime() <= rangeEnd.getTime()) {
          events.push({ date: icalTimeToJstDateString(event.startDate), title });
        }
      }
    }
    return events;
  } catch (err) {
    console.error('[business-calendar] ical fetch/parse failed', err);
    return [];
  }
}
