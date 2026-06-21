// QRコード経由のスタッフ向け「スタンプ付与・クーポン消し込み」フロー。
//
// 仕組み: お客様のLIFF画面が署名付き短命トークンを発行 → QRとして表示 → 店舗の人が
// LINEの標準QRリーダー (liff.line.me URLをそのまま開く仕様) で読む → 同じLIFFアプリが
// ?action=grant&token=... で開き、付与確認画面を表示 → 「付与する」を押して初めて実行。
// トークンがそのまま認可情報になるため、スキャンする側のLINEログインや友だち判定は不要。

import { Hono } from 'hono';
import type { Context } from 'hono';
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
  isAuthorizedGrantOperator,
  registerGrantOperator,
  getGrantOperators,
  removeGrantOperator,
  recordMilestoneIssued,
  getStampLogsForUserCard,
  getPointMultiplierRules,
  resolveActiveMultiplier,
} from '@line-crm/db';
import { signGrantToken, verifyGrantToken, signOperatorRegistrationToken, verifyOperatorRegistrationToken } from '../lib/qr-token.js';
import { verifyCallerLineUserId, verifyCallerProfile } from '../services/liff-auth.js';
import { applyRankUpRichMenu } from '../services/rank-rich-menu.js';
import type { Env } from '../index.js';

const stampGrant = new Hono<Env>();

const TOKEN_TTL_SECONDS = 5 * 60; // 5分。スクショ再利用の実害を抑える
const REGISTRATION_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 登録用QRは24時間有効 (店内に貼っておける程度の長さ)

async function resolveAccountIdFromLiff(c: Context<Env>): Promise<string | null> {
  const liffId = c.req.query('liffId');
  if (!liffId) return null;
  const acc = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1`)
    .bind(liffId)
    .first<{ id: string }>();
  return acc?.id ?? null;
}

/**
 * QRスタンプ付与の不正利用防止 (超重要): トークンの有効性だけでなく、スキャンした側の
 * LINEアカウントが事前登録済みオペレーターかどうかを必ず確認する。
 * 未登録なら 403 を返し、呼び出し元はスタンプ付与・クーポン消し込みを実行しない。
 */
async function requireAuthorizedOperator(c: Context<Env>, accountId: string): Promise<{ ok: true } | { ok: false; response: Response }> {
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) {
    return { ok: false, response: c.json({ success: false, error: 'operator_unauthenticated' }, 401) };
  }
  const authorized = await isAuthorizedGrantOperator(c.env.DB, accountId, callerLineUserId);
  if (!authorized) {
    return { ok: false, response: c.json({ success: false, error: 'operator_not_registered' }, 403) };
  }
  return { ok: true };
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

// GET /api/liff/stamp-cards/grant-preview?token=... — スキャンした側が見る確認画面用データ。
// トークンの有効性に加え、スキャンした側 (Authorization idToken) が登録済みオペレーターであることを要求する。
stampGrant.get('/api/liff/stamp-cards/grant-preview', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ success: false, error: 'token required' }, 400);
  const payload = await verifyGrantToken(c.env.API_KEY ?? 'dev-secret', token);
  if (!payload) return c.json({ success: false, error: 'invalid_or_expired_token' }, 401);

  const operatorCheck = await requireAuthorizedOperator(c, payload.accountId);
  if (!operatorCheck.ok) return operatorCheck.response;

  const friend = await getFriendById(c.env.DB, payload.friendId);
  if (!friend) return c.json({ success: false, error: 'friend_not_found' }, 404);

  const [card, settings, ranks, coupons, allCoupons] = await Promise.all([
    getOrCreateUserCard(c.env.DB, payload.friendId, payload.accountId),
    getCardSettings(c.env.DB, payload.accountId),
    getCardRanks(c.env.DB, payload.accountId),
    getUserCoupons(c.env.DB, payload.friendId, { status: 'unused' }),
    getUserCoupons(c.env.DB, payload.friendId),
  ]);
  const currentRank = settings?.rank_enabled ? ranks.find((r) => r.id === card.current_rank_id) ?? null : null;
  const stampLogs = await getStampLogsForUserCard(c.env.DB, card.id, 20);

  // 現時点で適用されているポイント倍率ルール (スタッフ画面に表示し、入力ポイント数のリアルタイム計算に使う)。
  const rules = await getPointMultiplierRules(c.env.DB, payload.accountId);
  const multiplierResolution = resolveActiveMultiplier(rules, new Date(), settings?.multiplier_combination_mode);

  return c.json({
    success: true,
    data: {
      friend: { displayName: friend.display_name, pictureUrl: friend.picture_url },
      card: { stampCount: card.stamp_count, currentRankName: currentRank?.name ?? null },
      stampRuleType: settings?.stamp_rule_type ?? 'per_visit',
      amountPerStamp: settings?.amount_per_stamp ?? null,
      activeMultiplier: {
        multiplier: multiplierResolution.multiplier,
        appliedRuleNames: multiplierResolution.appliedRules.map((r) => r.name),
      },
      coupons: coupons.map((cp) => ({
        id: cp.id, name: cp.display_name, description: cp.display_description, imageUrl: cp.display_image_url, expiresAt: cp.expires_at,
      })),
      // スタッフがその場で利用履歴を確認できるように、付与ログ・全クーポン履歴 (未使用/使用済/期限切れ) も返す。
      stampLogs: stampLogs.map((log) => ({
        id: log.id, source: log.source, finalPoints: log.final_points, multiplierApplied: log.multiplier_applied, createdAt: log.created_at,
      })),
      couponHistory: allCoupons.map((cp) => ({
        id: cp.id, name: cp.display_name, status: cp.status, issuedAt: cp.issued_at, expiresAt: cp.expires_at, usedAt: cp.used_at,
      })),
    },
  });
});

// POST /api/liff/stamp-cards/grant — 実際にスタンプを付与。
// トークンの有効性に加え、スキャンした側が登録済みオペレーターであることを要求する (不正利用防止)。
stampGrant.post('/api/liff/stamp-cards/grant', async (c) => {
  const body = await c.req.json<{ token: string; amountYen?: number; points?: number }>();
  const payload = await verifyGrantToken(c.env.API_KEY ?? 'dev-secret', body.token);
  if (!payload) return c.json({ success: false, error: 'invalid_or_expired_token' }, 401);

  const operatorCheck = await requireAuthorizedOperator(c, payload.accountId);
  if (!operatorCheck.ok) return operatorCheck.response;

  const settings = await getCardSettings(c.env.DB, payload.accountId);
  const source = settings?.stamp_rule_type === 'per_amount' ? 'amount' : 'visit';
  const result = await grantStamp(c.env.DB, {
    friendId: payload.friendId,
    lineAccountId: payload.accountId,
    source,
    amountYen: body.amountYen,
    manualBasePoints: source === 'visit' ? body.points : undefined,
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

  // ランク内マイルストーン (例: 10個中5個でクーポン) — 今回の付与で新たに到達した分だけ発行する。
  const milestoneCouponNames: string[] = [];
  if (result.milestonesCrossed.length > 0 && account && friend) {
    const { LineClient } = await import('@line-crm/line-sdk');
    const client = new LineClient(account.channel_access_token);
    for (const m of result.milestonesCrossed) {
      const coupon = await issueCoupon(c.env.DB, {
        friendId: payload.friendId,
        lineAccountId: payload.accountId,
        couponTemplateId: m.couponTemplateId,
        issuedVia: 'rank_clear',
        sourceUserCardId: result.card.id,
      });
      await recordMilestoneIssued(c.env.DB, { userCardId: result.card.id, milestoneId: m.milestoneId, issuedCouponId: coupon.id });
      milestoneCouponNames.push(coupon.coupon_name_at_issuance ?? 'クーポン');
      await client.pushTextMessage(
        friend.line_user_id,
        `「${coupon.coupon_name_at_issuance ?? 'クーポン'}」を獲得しました！（有効期限: ${new Date(coupon.expires_at).toLocaleDateString('ja-JP')}まで）。`,
      );
    }
  }

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

// POST /api/liff/coupons/:id/redeem — クーポンの消し込み。トークンの有効性 + friendId一致 +
// スキャンした側が登録済みオペレーターであることを要求する (不正利用防止)。
stampGrant.post('/api/liff/coupons/:id/redeem', async (c) => {
  const body = await c.req.json<{ token: string }>();
  const payload = await verifyGrantToken(c.env.API_KEY ?? 'dev-secret', body.token);
  if (!payload) return c.json({ success: false, error: 'invalid_or_expired_token' }, 401);

  const operatorCheck = await requireAuthorizedOperator(c, payload.accountId);
  if (!operatorCheck.ok) return operatorCheck.response;

  const coupon = await c.env.DB.prepare(`SELECT friend_id FROM user_coupons WHERE id = ?`).bind(c.req.param('id')).first<{ friend_id: string }>();
  if (!coupon || coupon.friend_id !== payload.friendId) return c.json({ success: false, error: 'not_found' }, 404);

  const result = await markCouponUsed(c.env.DB, c.req.param('id'), null);
  if (!result.success) return c.json({ success: false, error: result.error }, 409);
  return c.json({ success: true, data: null });
});

// ── スタッフ登録 (オペレーター allowlist) ──────────────────────────────────

// GET /api/card-grant-operators/registration-link?accountId=xxx — 管理画面が表示する登録用QRのURLを発行
stampGrant.get('/api/card-grant-operators/registration-link', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account?.liff_id) return c.json({ success: false, error: 'liff_not_configured' }, 400);

  const exp = Math.floor(Date.now() / 1000) + REGISTRATION_TOKEN_TTL_SECONDS;
  const token = await signOperatorRegistrationToken(c.env.API_KEY ?? 'dev-secret', { accountId, exp });
  const url = `https://liff.line.me/${account.liff_id}?page=stamp-card&action=register-operator&token=${encodeURIComponent(token)}`;
  return c.json({ success: true, data: { url, expiresAt: exp } });
});

// GET /api/card-grant-operators?accountId=xxx — 登録済みオペレーター一覧 (管理画面)
stampGrant.get('/api/card-grant-operators', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const operators = await getGrantOperators(c.env.DB, accountId);
  return c.json({ success: true, data: operators });
});

// DELETE /api/card-grant-operators/:id — オペレーター登録の取り消し (管理画面)
stampGrant.delete('/api/card-grant-operators/:id', async (c) => {
  await removeGrantOperator(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});

// POST /api/liff/stamp-cards/register-operator — スタッフが登録用QRをスキャンして開いた際に呼ぶ (要 idToken)
stampGrant.post('/api/liff/stamp-cards/register-operator', async (c) => {
  const body = await c.req.json<{ token: string }>();
  const payload = await verifyOperatorRegistrationToken(c.env.API_KEY ?? 'dev-secret', body.token);
  if (!payload) return c.json({ success: false, error: 'invalid_or_expired_token' }, 401);

  const profile = await verifyCallerProfile(c.req.header('Authorization'), c.env);
  if (!profile) return c.json({ success: false, error: 'unauthorized' }, 401);

  const operator = await registerGrantOperator(c.env.DB, {
    lineAccountId: payload.accountId,
    lineUserId: profile.lineUserId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
  });
  return c.json({ success: true, data: operator });
});

export { stampGrant };
