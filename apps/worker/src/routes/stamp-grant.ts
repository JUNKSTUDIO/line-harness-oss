// QRコード経由のスタッフ向け「スタンプ付与・クーポン消し込み」フロー。
//
// 仕組み: お客様のLIFF画面が署名付き短命トークンを発行 → QRとして表示 → 店舗の人が
// LINEの標準QRリーダー (liff.line.me URLをそのまま開く仕様) で読む → 同じLIFFアプリが
// ?action=grant&token=... で開き、付与確認画面を表示 → 「付与する」を押して初めて実行。
// トークンがそのまま認可情報になるため、スキャンする側のLINEログインや友だち判定は不要。

import { Hono } from 'hono';
import {
  getOrCreateUserCard,
  getCardSettings,
  getCardRanks,
  grantStamp,
  issueCoupon,
  getUserCoupons,
  markCouponUsed,
  getLineAccountById,
  getFriendById,
} from '@line-crm/db';
import { signGrantToken, verifyGrantToken } from '../lib/qr-token.js';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { applyRankUpRichMenu } from '../services/rank-rich-menu.js';
import type { Env } from '../index.js';

const stampGrant = new Hono<Env>();

const TOKEN_TTL_SECONDS = 5 * 60; // 5分。スクショ再利用の実害を抑える

async function resolveAccountIdFromLiff(c: import('hono').Context<Env>): Promise<string | null> {
  const liffId = c.req.query('liffId');
  if (!liffId) return null;
  const acc = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1`)
    .bind(liffId)
    .first<{ id: string }>();
  return acc?.id ?? null;
}

// GET /api/liff/stamp-cards/qr-token — お客様自身が発行 (要 idToken)
stampGrant.get('/api/liff/stamp-cards/qr-token', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ success: false, error: 'liff_account_resolution_failed' }, 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return c.json({ success: false, error: 'unauthorized' }, 401);
  const friend = await c.env.DB
    .prepare(`SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
    .bind(callerLineUserId, accountId)
    .first<{ id: string }>();
  if (!friend) return c.json({ success: false, error: 'friend_not_found' }, 404);

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const token = await signGrantToken(c.env.API_KEY ?? 'dev-secret', { friendId: friend.id, accountId, exp });
  return c.json({ success: true, data: { token, expiresAt: exp } });
});

// GET /api/liff/stamp-cards/grant-preview?token=... — スキャンした側が見る確認画面用データ (トークンが認可情報)
stampGrant.get('/api/liff/stamp-cards/grant-preview', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ success: false, error: 'token required' }, 400);
  const payload = await verifyGrantToken(c.env.API_KEY ?? 'dev-secret', token);
  if (!payload) return c.json({ success: false, error: 'invalid_or_expired_token' }, 401);

  const friend = await getFriendById(c.env.DB, payload.friendId);
  if (!friend) return c.json({ success: false, error: 'friend_not_found' }, 404);

  const [card, settings, ranks, coupons] = await Promise.all([
    getOrCreateUserCard(c.env.DB, payload.friendId, payload.accountId),
    getCardSettings(c.env.DB, payload.accountId),
    getCardRanks(c.env.DB, payload.accountId),
    getUserCoupons(c.env.DB, payload.friendId, { status: 'unused' }),
  ]);
  const currentRank = settings?.rank_enabled ? ranks.find((r) => r.id === card.current_rank_id) ?? null : null;

  return c.json({
    success: true,
    data: {
      friend: { displayName: friend.display_name, pictureUrl: friend.picture_url },
      card: { stampCount: card.stamp_count, currentRankName: currentRank?.name ?? null },
      stampRuleType: settings?.stamp_rule_type ?? 'per_visit',
      coupons: coupons.map((cp) => ({ id: cp.id, expiresAt: cp.expires_at })),
    },
  });
});

// POST /api/liff/stamp-cards/grant — 実際にスタンプを付与 (トークンが認可情報)
stampGrant.post('/api/liff/stamp-cards/grant', async (c) => {
  const body = await c.req.json<{ token: string; amountYen?: number }>();
  const payload = await verifyGrantToken(c.env.API_KEY ?? 'dev-secret', body.token);
  if (!payload) return c.json({ success: false, error: 'invalid_or_expired_token' }, 401);

  const settings = await getCardSettings(c.env.DB, payload.accountId);
  const source = settings?.stamp_rule_type === 'per_amount' ? 'amount' : 'visit';
  const result = await grantStamp(c.env.DB, {
    friendId: payload.friendId,
    lineAccountId: payload.accountId,
    source,
    amountYen: body.amountYen,
  });

  const account = await getLineAccountById(c.env.DB, payload.accountId);
  const friend = await getFriendById(c.env.DB, payload.friendId);

  if (result.issuedCoupon && account && friend) {
    const coupon = await issueCoupon(c.env.DB, {
      friendId: payload.friendId,
      lineAccountId: payload.accountId,
      couponTemplateId: result.issuedCoupon.templateId,
      issuedVia: 'rank_clear',
      sourceUserCardId: result.card.id,
    });
    const { LineClient } = await import('@line-crm/line-sdk');
    const client = new LineClient(account.channel_access_token);
    await client.pushTextMessage(
      friend.line_user_id,
      `ランクアップおめでとうございます！クーポンを発行しました（有効期限: ${new Date(coupon.expires_at).toLocaleDateString('ja-JP')}まで）。`,
    );
  }

  if (result.rankedUp && account) {
    await applyRankUpRichMenu(c.env.DB, account, payload.friendId, result.card.current_rank_id);
  }

  return c.json({ success: true, data: { stampCount: result.card.stamp_count, finalPoints: result.finalPoints, rankedUp: result.rankedUp, issuedCoupon: !!result.issuedCoupon } });
});

// POST /api/liff/coupons/:id/redeem — クーポンの消し込み (トークンが認可情報。friendIdの一致を確認)
stampGrant.post('/api/liff/coupons/:id/redeem', async (c) => {
  const body = await c.req.json<{ token: string }>();
  const payload = await verifyGrantToken(c.env.API_KEY ?? 'dev-secret', body.token);
  if (!payload) return c.json({ success: false, error: 'invalid_or_expired_token' }, 401);

  const coupon = await c.env.DB.prepare(`SELECT friend_id FROM user_coupons WHERE id = ?`).bind(c.req.param('id')).first<{ friend_id: string }>();
  if (!coupon || coupon.friend_id !== payload.friendId) return c.json({ success: false, error: 'not_found' }, 404);

  const result = await markCouponUsed(c.env.DB, c.req.param('id'), null);
  if (!result.success) return c.json({ success: false, error: result.error }, 409);
  return c.json({ success: true, data: null });
});

export { stampGrant };
