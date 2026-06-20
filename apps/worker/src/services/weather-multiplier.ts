// 「雨の日2倍」等の weather 型ポイント倍率ルールを、外部天気APIと連動して自動ON/OFFする。
// Open-Meteo (https://open-meteo.com/) — APIキー不要・商用利用可の無料天気API。
// 5分ごとのcron tickに乗せるが、外部API呼び出し自体は店舗ごとに card_settings.weather_check_interval_minutes
// (既存の insight-fetcher と同じ「self-throttled」パターン。管理画面で間隔を設定可能)。

import {
  getCardSettingsWithWeatherLocation,
  markWeatherChecked,
  getPointMultiplierRules,
  setMultiplierRuleActive,
} from '@line-crm/db';

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
    const lastChecked = settings.weather_last_checked_at ? new Date(settings.weather_last_checked_at).getTime() : 0;
    const intervalMs = (settings.weather_check_interval_minutes ?? 30) * 60_000;
    if (now.getTime() - lastChecked < intervalMs) continue;
    if (settings.shop_latitude == null || settings.shop_longitude == null) continue;

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
