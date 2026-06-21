// クーポンテンプレート管理 + 期限切れクーポンの検索・手動救済 — 管理画面向けエンドポイント。

import { Hono } from 'hono';
import {
  getCouponTemplates,
  createCouponTemplate,
  updateCouponTemplate,
  deleteCouponTemplate,
  countIssuedCouponsForTemplate,
  findExpiredCouponHolders,
  rescueCoupon,
  getLineAccountById,
  type CouponTemplateRow,
} from '@line-crm/db';
import type { Env } from '../index.js';

const couponTemplates = new Hono<Env>();

// GET /api/coupon-templates?accountId=xxx
couponTemplates.get('/api/coupon-templates', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const templates = await getCouponTemplates(c.env.DB, accountId);
  return c.json({ success: true, data: templates });
});

// POST /api/coupon-templates
couponTemplates.post('/api/coupon-templates', async (c) => {
  const body = await c.req.json<{
    accountId: string;
    name: string;
    description?: string | null;
    validityType: CouponTemplateRow['validity_type'];
    validityDays?: number | null;
    absoluteExpiresAt?: string | null;
    imageUrl?: string | null;
  }>();
  if (!body.accountId || !body.name || !body.validityType) {
    return c.json({ success: false, error: 'accountId, name, validityType required' }, 400);
  }
  const template = await createCouponTemplate(c.env.DB, {
    lineAccountId: body.accountId,
    name: body.name,
    description: body.description,
    validityType: body.validityType,
    validityDays: body.validityDays,
    absoluteExpiresAt: body.absoluteExpiresAt,
    imageUrl: body.imageUrl,
  });
  return c.json({ success: true, data: template }, 201);
});

// PATCH /api/coupon-templates/:id
couponTemplates.patch('/api/coupon-templates/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const template = await updateCouponTemplate(c.env.DB, c.req.param('id'), body);
  if (!template) return c.json({ success: false, error: 'not_found' }, 404);
  return c.json({ success: true, data: template });
});

// DELETE /api/coupon-templates/:id
// user_coupons.coupon_template_id は ON DELETE CASCADE のため、既発行のクーポンがある
// テンプレートを無条件に削除すると、お客様が既に持っている/使用済みのクーポンまで
// 一緒に消えてしまう。ここで件数を確認し、1件でもあれば削除を拒否する
// (管理画面側は is_active=false への「無効化」を代替手段として提示する)。
couponTemplates.delete('/api/coupon-templates/:id', async (c) => {
  const issuedCount = await countIssuedCouponsForTemplate(c.env.DB, c.req.param('id'));
  if (issuedCount > 0) {
    return c.json({ success: false, error: 'has_issued_coupons', issuedCount }, 409);
  }
  await deleteCouponTemplate(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});

// GET /api/coupons/expired?accountId=xxx — 期限切れクーポン保持者の検索 (要件④管理画面②)
couponTemplates.get('/api/coupons/expired', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const limit = Number(c.req.query('limit') ?? '50');
  const offset = Number(c.req.query('offset') ?? '0');
  const items = await findExpiredCouponHolders(c.env.DB, accountId, { limit, offset });
  return c.json({ success: true, data: items });
});

// POST /api/coupons/:id/rescue — 手動救済 (有効期限を再設定 + LINEメッセージ送信。要件④管理画面③)
couponTemplates.post('/api/coupons/:id/rescue', async (c) => {
  const body = await c.req.json<{ accountId: string; extendDays: number }>();
  if (!body.accountId || !body.extendDays) {
    return c.json({ success: false, error: 'accountId, extendDays required' }, 400);
  }
  const coupon = await rescueCoupon(c.env.DB, c.req.param('id'), { extendDays: body.extendDays });

  const account = await getLineAccountById(c.env.DB, body.accountId);
  const friend = await c.env.DB.prepare(`SELECT line_user_id FROM friends WHERE id = ?`).bind(coupon.friend_id).first<{ line_user_id: string }>();
  if (account && friend) {
    const { LineClient } = await import('@line-crm/line-sdk');
    const client = new LineClient(account.channel_access_token);
    await client.pushTextMessage(
      friend.line_user_id,
      'クーポンがもう一度使えるようになりました！ぜひご来店ください。',
    );
  }

  return c.json({ success: true, data: coupon });
});

export { couponTemplates };
