// スタンプカード設定 — 管理画面向けエンドポイント。
// account-settings.ts と同じ「accountId query param, 認証は全体のauthMiddlewareに委ねる」流儀。

import { Hono } from 'hono';
import { getCardSettings, upsertCardSettings, type CardSettingsRow } from '@line-crm/db';
import { geocodeJapaneseAddress } from '../lib/geocode.js';
import type { Env } from '../index.js';

const cardSettings = new Hono<Env>();

// GET /api/card-settings?accountId=xxx
cardSettings.get('/api/card-settings', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const settings = await getCardSettings(c.env.DB, accountId);
  return c.json({
    success: true,
    data: settings ?? {
      line_account_id: accountId,
      stamp_rule_type: 'per_visit',
      amount_per_stamp: null,
      signup_bonus_stamps: 0,
      rank_enabled: 0,
      flat_goal_stamps: null,
      card_expiry_months: null,
      card_expiry_mode: 'since_last_stamp',
      card_expiry_days_from_issue: null,
      card_expiry_self_extension_enabled: 1,
      card_expiry_penalty_type: 'none',
      card_expiry_penalty_target_rank_id: null,
      stamp_angle_enabled: 1,
      multiplier_combination_mode: 'highest_priority_only',
      friend_anniversary_multiplier_enabled: 0,
      friend_anniversary_multiplier_value: 1.5,
      friend_anniversary_reminder_message: null,
      birthday_coupon_enabled: 0,
      birthday_coupon_template_id: null,
      default_coupon_validity_days: 30,
      reminder_days_before: 3,
      reminder_reservation_button_label: null,
      reminder_reservation_helper_text: null,
      reminder_extend_button_label: null,
      reservation_url: null,
      stamp_image_url: null,
      shop_latitude: null,
      shop_longitude: null,
      shop_address: null,
      weather_check_interval_minutes: 30,
      weather_check_anchor_time: '00:00',
      rank_badge_layout: 'split',
    },
  });
});

// PATCH /api/card-settings?accountId=xxx
cardSettings.patch('/api/card-settings', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const body = await c.req.json<Partial<Omit<CardSettingsRow, 'line_account_id' | 'created_at' | 'updated_at'>>>();
  const updated = await upsertCardSettings(c.env.DB, accountId, body);
  return c.json({ success: true, data: updated });
});

// POST /api/card-settings/geocode-address?accountId=xxx — 住所文字列から緯度経度を自動取得して保存
cardSettings.post('/api/card-settings/geocode-address', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const body = await c.req.json<{ address: string }>();
  if (!body.address) return c.json({ success: false, error: 'address required' }, 400);

  const result = await geocodeJapaneseAddress(body.address);
  if (!result) {
    return c.json({ success: false, error: 'geocode_failed' }, 422);
  }

  const updated = await upsertCardSettings(c.env.DB, accountId, {
    shop_address: body.address,
    shop_latitude: result.latitude,
    shop_longitude: result.longitude,
  });
  return c.json({ success: true, data: updated });
});

export { cardSettings };
