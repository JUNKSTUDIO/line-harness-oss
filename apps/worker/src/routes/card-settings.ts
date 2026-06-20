// スタンプカード設定 — 管理画面向けエンドポイント。
// account-settings.ts と同じ「accountId query param, 認証は全体のauthMiddlewareに委ねる」流儀。

import { Hono } from 'hono';
import { getCardSettings, upsertCardSettings, type CardSettingsRow } from '@line-crm/db';
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
      default_coupon_validity_days: 30,
      reminder_days_before: 3,
      reservation_url: null,
      stamp_image_url: null,
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

export { cardSettings };
