// お客様ごとのスタンプ付与履歴・クーポン利用履歴 — 管理画面 + スタッフのQRスキャン画面で共用する。
// + 管理画面からの遠隔ポイント付与・クーポン発行 (QRコード読み取り不要)。

import { Hono } from 'hono';
import {
  getUserCard, getStampLogsForUserCard, getUserCoupons, getCardSettings, grantStamp,
  issueCoupon, getCouponTemplateById, getLineAccountById, getFriendById,
} from '@line-crm/db';
import { processGrantStampSideEffects } from '../services/grant-stamp-side-effects.js';
import { sendCouponIssuedNotification } from '../services/card-coupon-notifier.js';
import type { Env } from '../index.js';

const stampCardHistory = new Hono<Env>();

const ROLE_LEVEL: Record<'owner' | 'admin' | 'staff', number> = { staff: 1, admin: 2, owner: 3 };

/** card_settings.remote_grant_min_role 以上のロールを持つスタッフだけ、管理画面からの遠隔付与を実行できる。 */
function hasRemoteGrantPermission(actualRole: 'owner' | 'admin' | 'staff', minRole: 'owner' | 'admin' | 'staff'): boolean {
  return ROLE_LEVEL[actualRole] >= ROLE_LEVEL[minRole];
}

// GET /api/friends/:friendId/stamp-card-history?accountId=xxx
stampCardHistory.get('/api/friends/:friendId/stamp-card-history', async (c) => {
  const accountId = c.req.query('accountId');
  const friendId = c.req.param('friendId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const card = await getUserCard(c.env.DB, friendId, accountId);
  const [stampLogs, coupons] = await Promise.all([
    card ? getStampLogsForUserCard(c.env.DB, card.id) : Promise.resolve([]),
    getUserCoupons(c.env.DB, friendId),
  ]);

  return c.json({
    success: true,
    data: {
      card: card ? { stampCount: card.stamp_count, totalStampCount: card.total_stamp_count, status: card.status } : null,
      stampLogs,
      coupons: coupons.map((cp) => ({
        id: cp.id,
        name: cp.display_name,
        description: cp.display_description,
        imageUrl: cp.display_image_url,
        status: cp.status,
        issuedAt: cp.issued_at,
        expiresAt: cp.expires_at,
        usedAt: cp.used_at,
      })),
    },
  });
});

// POST /api/friends/:friendId/stamp-card/grant-points — 管理画面からの遠隔ポイント付与 (QR読み取り不要)。
// 倍率ルール・記念日ボーナスは適用せず、入力した数値をそのまま付与する (grantStampのskipMultiplier)。
stampCardHistory.post('/api/friends/:friendId/stamp-card/grant-points', async (c) => {
  const friendId = c.req.param('friendId');
  const body = await c.req.json<{ accountId?: string; points?: number }>();
  const accountId = body.accountId;
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  if (typeof body.points !== 'number' || body.points <= 0 || !Number.isFinite(body.points) || Math.round(body.points * 2) !== body.points * 2) {
    return c.json({ success: false, error: 'invalid_points' }, 400);
  }

  const staff = c.get('staff');
  const settings = await getCardSettings(c.env.DB, accountId);
  if (!staff || !hasRemoteGrantPermission(staff.role, settings?.remote_grant_min_role ?? 'owner')) {
    return c.json({ success: false, error: 'insufficient_role' }, 403);
  }

  const friend = await getFriendById(c.env.DB, friendId);
  if (!friend || friend.line_account_id !== accountId) return c.json({ success: false, error: 'friend_not_found' }, 404);

  const result = await grantStamp(c.env.DB, {
    friendId,
    lineAccountId: accountId,
    source: 'manual',
    manualBasePoints: body.points,
    skipMultiplier: true,
    // 'env-owner' は staff テーブルに実体を持たない疑似ID (環境変数API_KEYでの認証時) なので、
    // 外部キー違反にならないよう実在するスタッフの場合のみ記録する。
    grantedByStaffId: staff.id === 'env-owner' ? undefined : staff.id,
  });
  const { milestoneCouponNames } = await processGrantStampSideEffects(c.env.DB, accountId, friendId, result);

  return c.json({
    success: true,
    data: {
      stampCount: result.card.stamp_count,
      finalPoints: result.finalPoints,
      rankedUp: result.rankedUp,
      issuedCoupon: !!result.issuedCoupon,
      milestoneCouponNames,
    },
  });
});

// POST /api/friends/:friendId/stamp-card/issue-coupon — 管理画面から既存のクーポンテンプレートを直接発行する。
stampCardHistory.post('/api/friends/:friendId/stamp-card/issue-coupon', async (c) => {
  const friendId = c.req.param('friendId');
  const body = await c.req.json<{ accountId?: string; couponTemplateId?: string }>();
  const accountId = body.accountId;
  if (!accountId || !body.couponTemplateId) return c.json({ success: false, error: 'accountId and couponTemplateId required' }, 400);

  const staff = c.get('staff');
  const settings = await getCardSettings(c.env.DB, accountId);
  if (!staff || !hasRemoteGrantPermission(staff.role, settings?.remote_grant_min_role ?? 'owner')) {
    return c.json({ success: false, error: 'insufficient_role' }, 403);
  }

  const friend = await getFriendById(c.env.DB, friendId);
  if (!friend || friend.line_account_id !== accountId) return c.json({ success: false, error: 'friend_not_found' }, 404);

  const template = await getCouponTemplateById(c.env.DB, body.couponTemplateId);
  if (!template || template.line_account_id !== accountId || !template.is_active) {
    return c.json({ success: false, error: 'coupon_template_not_found' }, 404);
  }

  const coupon = await issueCoupon(c.env.DB, {
    friendId,
    lineAccountId: accountId,
    couponTemplateId: body.couponTemplateId,
    issuedVia: 'manual',
  });

  const account = await getLineAccountById(c.env.DB, accountId);
  if (account) {
    await sendCouponIssuedNotification({
      db: c.env.DB,
      channelAccessToken: account.channel_access_token,
      toLineUserId: friend.line_user_id,
      liffId: account.liff_id,
      messageTemplateId: template.message_template_id,
      fallbackText: `「${coupon.coupon_name_at_issuance ?? 'クーポン'}」が付与されました！（有効期限: ${new Date(coupon.expires_at).toLocaleDateString('ja-JP')}まで）。`,
      coupon: {
        name: coupon.coupon_name_at_issuance ?? 'クーポン',
        imageUrl: coupon.coupon_image_url_at_issuance,
        expiresAtJst: new Date(coupon.expires_at).toLocaleDateString('ja-JP'),
      },
    });
  }

  return c.json({ success: true, data: coupon });
});

export { stampCardHistory };
