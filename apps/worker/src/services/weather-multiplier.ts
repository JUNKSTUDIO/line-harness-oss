// 「雨の日2倍」等の weather 型ポイント倍率ルールを、外部天気APIと連動して自動ON/OFFする。
// Open-Meteo (https://open-meteo.com/) — APIキー不要・商用利用可の無料天気API。
// 5分ごとのcron tickに乗せるが、外部API呼び出し自体は店舗ごとに card_settings.weather_check_interval_minutes
// (既存の insight-fetcher と同じ「self-throttled」パターン。管理画面で間隔を設定可能)。
//
// 「何分ごと」の基準点 (起点) は weather_check_anchor_time (JST "HH:MM"、既定 "00:00")。
// 単純な「前回チェックからN分経過したか」だと、起点が「サーバが最初にチェックした
// 偶然の時刻」になり日によって少しずつズレてしまう。代わりに、起点時刻からの経過時間を
// interval_minutes でバケット分割し、前回と今回でバケットが変わったかどうかで判定する
// ことで、毎日決まった時刻 (例: 06:00, 1440分=1日間隔なら毎日06:00丁度) に固定される。

import {
  getCardSettingsWithWeatherLocation,
  markWeatherChecked,
  getPointMultiplierRules,
  setMultiplierRuleActive,
} from '@line-crm/db';

const JST_OFFSET_MS = 9 * 60 * 60_000;

/** anchorTime (JST "HH:MM") を起点に、date が何個目の interval バケットに入るかを返す。 */
function weatherCheckBucket(date: Date, anchorTime: string, intervalMinutes: number): number {
  const [anchorH, anchorM] = anchorTime.split(':').map(Number);
  const anchorMsOfDay = ((anchorH || 0) * 60 + (anchorM || 0)) * 60_000;
  const jstMs = date.getTime() + JST_OFFSET_MS;
  return Math.floor((jstMs - anchorMsOfDay) / (intervalMinutes * 60_000));
}

interface OpenMeteoCurrentResponse {
  current?: { rain?: number; snowfall?: number };
}

async function fetchCurrentConditions(lat: number, lon: number): Promise<{ isRaining: boolean; isSnowing: boolean } | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=rain,snowfall&timezone=Asia%2FTokyo`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoCurrentResponse;
    return {
      isRaining: (data.current?.rain ?? 0) > 0,
      isSnowing: (data.current?.snowfall ?? 0) > 0,
    };
  } catch (err) {
    console.error('[weather-multiplier] fetch failed', err);
    return null;
  }
}

export async function processWeatherMultiplierToggles(db: D1Database, now: Date): Promise<{ checked: number }> {
  const targets = await getCardSettingsWithWeatherLocation(db);
  let checked = 0;

  for (const settings of targets) {
    if (settings.shop_latitude == null || settings.shop_longitude == null) continue;

    const interval = settings.weather_check_interval_minutes ?? 30;
    const anchor = settings.weather_check_anchor_time || '00:00';
    const currentBucket = weatherCheckBucket(now, anchor, interval);
    const lastBucket = settings.weather_last_checked_at
      ? weatherCheckBucket(new Date(settings.weather_last_checked_at), anchor, interval)
      : null;
    if (lastBucket !== null && currentBucket <= lastBucket) continue;

    const conditions = await fetchCurrentConditions(settings.shop_latitude, settings.shop_longitude);
    if (!conditions) continue;

    const rules = await getPointMultiplierRules(db, settings.line_account_id);
    for (const rule of rules) {
      if (rule.condition_type !== 'weather') continue;
      const shouldBeActive = rule.weather_condition === 'rain' ? conditions.isRaining
        : rule.weather_condition === 'snow' ? conditions.isSnowing
        : false;
      if (!!rule.is_active !== shouldBeActive) {
        await setMultiplierRuleActive(db, rule.id, shouldBeActive);
      }
    }
    await markWeatherChecked(db, settings.line_account_id);
    checked++;
  }

  return { checked };
}
