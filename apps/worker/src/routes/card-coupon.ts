// スタンプカード/クーポン — LIFF向けエンドポイント。
// 認証は既存の verifyCallerLineUserId (LIFF id_token 検証, services/liff-auth.ts) を共有し、
// アカウント解決は events.ts と同じ ?liffId= → line_accounts.liff_id パターンに揃える。

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getOrCreateUserCard,
  getCardRanks,
  getCardSettings,
  getUserCoupons,
  extendUserCardExpiry,
  extendUserCouponExpiry,
  getUserCardById,
  getUserCouponById,
  getLineAccountById,
  getCardRankMilestones,
  getIssuedMilestoneIds,
  getCouponTemplateById,
  setFriendBirthday,
} from '@line-crm/db';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { sendExtensionConfirmed, sendExtensionAlreadyUsed } from '../services/card-coupon-notifier.js';
import { fetchIcalEvents, toJstDateString } from '../services/business-calendar.js';
import type { Env } from '../index.js';

const cardCoupon = new Hono<Env>();

function bad(c: Context<Env>, code: string, status = 422): Response {
  return c.json({ error: code }, status as 400 | 401 | 403 | 404 | 422);
}

async function resolveAccountIdFromLiff(c: Context<Env>): Promise<string | null> {
  const liffId = c.req.query('liffId');
  if (!liffId) return null;
  const acc = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1`)
    .bind(liffId)
    .first<{ id: string }>();
  return acc?.id ?? null;
}

async function resolveFriend(c: Context<Env>, accountId: string, lineUserId: string) {
  return c.env.DB
    .prepare(`SELECT id, line_account_id, birthday_year, birthday_month, birthday_day FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
    .bind(lineUserId, accountId)
    .first<{ id: string; line_account_id: string; birthday_year: number | null; birthday_month: number | null; birthday_day: number | null }>();
}

// GET /api/liff/cards/me — 現在の友だちのスタンプカード状態 (画面表示用)
cardCoupon.get('/api/liff/cards/me', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await resolveFriend(c, accountId, callerLineUserId);
  if (!friend) return bad(c, 'friend_not_found', 404);

  const [card, settings, ranks] = await Promise.all([
    getOrCreateUserCard(c.env.DB, friend.id, accountId),
    getCardSettings(c.env.DB, accountId),
    getCardRanks(c.env.DB, accountId),
  ]);

  const currentRank = settings?.rank_enabled ? ranks.find((r) => r.id === card.current_rank_id) ?? null : null;
  const goal = settings?.rank_enabled ? currentRank?.max_stamps ?? null : settings?.flat_goal_stamps ?? null;
  const nextRank = currentRank ? ranks.find((r) => r.rank_order === currentRank.rank_order + 1) ?? null : null;

  // セルフ延長ボタンは「期限が近づいている場合のみ」表示 (要件④/⑤)。管理画面でOFFにできる。
  const reminderDaysBefore = settings?.reminder_days_before ?? 3;
  const canExtend =
    settings?.card_expiry_self_extension_enabled !== 0 &&
    !card.expiration_extended &&
    card.expires_at != null &&
    new Date(card.expires_at).getTime() - Date.now() <= reminderDaysBefore * 24 * 3600_000;

  // ランク内マイルストーン (例: 10個中5個でクーポン) — スタンプ画面にタップ可能な印を出すための情報。
  let milestones: Array<{ threshold: number; couponName: string; couponDescription: string | null; couponImageUrl: string | null; alreadyIssued: boolean }> = [];
  if (currentRank) {
    const rankMilestones = await getCardRankMilestones(c.env.DB, currentRank.id);
    if (rankMilestones.length > 0) {
      const issuedIds = await getIssuedMilestoneIds(c.env.DB, card.id);
      milestones = await Promise.all(
        rankMilestones.map(async (m) => {
          const template = await getCouponTemplateById(c.env.DB, m.coupon_template_id);
          return {
            threshold: m.stamp_threshold,
            couponName: template?.name ?? '(不明なクーポン)',
            couponDescription: template?.description ?? null,
            couponImageUrl: template?.image_url ?? null,
            alreadyIssued: issuedIds.has(m.id),
          };
        }),
      );
    }
  }

  return c.json({
    card: {
      id: card.id,
      stampCount: card.stamp_count,
      totalStampCount: card.total_stamp_count,
      goal,
      remainingToGoal: goal != null ? Math.max(0, goal - card.stamp_count) : null,
      rankEnabled: !!settings?.rank_enabled,
      currentRankName: currentRank?.name ?? null,
      currentRankImageUrl: currentRank?.image_url ?? null,
      nextRankName: nextRank?.name ?? null,
      expiresAt: card.expires_at,
      expirationExtended: !!card.expiration_extended,
      canExtend,
      status: card.status,
      milestones,
    },
    reservationUrl: settings?.reservation_url ?? null,
    stampImageUrl: settings?.stamp_image_url ?? null,
    rankBadgeLayout: settings?.rank_badge_layout ?? 'split',
    stampAngleEnabled: settings?.stamp_angle_enabled !== 0,
    birthday: friend.birthday_month != null && friend.birthday_day != null
      ? { year: friend.birthday_year, month: friend.birthday_month, day: friend.birthday_day }
      : null,
  });
});

// POST /api/liff/friends/me/birthday — お客様が自分の誕生日を登録/編集する (誕生月クーポンの自動発行に使う)
cardCoupon.post('/api/liff/friends/me/birthday', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await resolveFriend(c, accountId, callerLineUserId);
  if (!friend) return bad(c, 'friend_not_found', 404);

  const body = await c.req.json<{ year?: number | null; month: number; day: number }>();
  if (!body.month || !body.day || body.month < 1 || body.month > 12 || body.day < 1 || body.day > 31) {
    return bad(c, 'invalid_birthday', 400);
  }

  await setFriendBirthday(c.env.DB, friend.id, { year: body.year ?? null, month: body.month, day: body.day });
  return c.json({ success: true });
});

// GET /api/liff/coupons/me — 保有クーポン一覧 (既定: unused のみ)
cardCoupon.get('/api/liff/coupons/me', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await resolveFriend(c, accountId, callerLineUserId);
  if (!friend) return c.json({ items: [] });

  const statusParam = c.req.query('status');
  const status = statusParam === 'used' || statusParam === 'expired' || statusParam === 'unused' ? statusParam : 'unused';
  const coupons = await getUserCoupons(c.env.DB, friend.id, { status });
  const settings = await getCardSettings(c.env.DB, accountId);
  const reminderDaysBefore = settings?.reminder_days_before ?? 3;

  return c.json({
    items: coupons.map((coupon) => ({
      id: coupon.id,
      name: coupon.display_name,
      description: coupon.display_description,
      imageUrl: coupon.display_image_url,
      status: coupon.status,
      expiresAt: coupon.expires_at,
      expirationExtended: !!coupon.expiration_extended,
      canExtend:
        coupon.status === 'unused' &&
        !coupon.expiration_extended &&
        new Date(coupon.expires_at).getTime() - Date.now() <= reminderDaysBefore * 24 * 3600_000,
    })),
  });
});

// GET /api/liff/calendar?month=YYYY-MM — 営業日カレンダー (iCal予定 + クーポン/カード有効期限)。
// month省略時は今月。表示可能範囲は [今月, 今月+calendar_months_ahead-1] にクランプする。
cardCoupon.get('/api/liff/calendar', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await resolveFriend(c, accountId, callerLineUserId);
  if (!friend) return bad(c, 'friend_not_found', 404);

  const settings = await getCardSettings(c.env.DB, accountId);
  const monthsAhead = Math.max(1, settings?.calendar_months_ahead ?? 3);

  // 「今月」はJST基準で決める (Workerの実行時タイムゾーンはUTCのため、+9hシフト後にUTC getterで読む)。
  const nowJst = new Date(Date.now() + 9 * 3600_000);
  const currentY = nowJst.getUTCFullYear();
  const currentM = nowJst.getUTCMonth(); // 0-indexed
  const currentIndex = currentY * 12 + currentM;
  const maxIndex = currentIndex + monthsAhead - 1;

  let targetIndex = currentIndex;
  const monthParam = c.req.query('month');
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    const requestedIndex = y * 12 + (m - 1);
    if (requestedIndex >= currentIndex && requestedIndex <= maxIndex) targetIndex = requestedIndex;
  }
  const targetY = Math.floor(targetIndex / 12);
  const targetM = targetIndex % 12; // 0-indexed

  // 対象月のJST範囲を実時刻 (UTC instant) に変換する。JST 00:00 = UTC -9h。
  const rangeStart = new Date(Date.UTC(targetY, targetM, 1, 0, 0, 0) - 9 * 3600_000);
  const rangeEnd = new Date(Date.UTC(targetY, targetM + 1, 0, 23, 59, 59, 999) - 9 * 3600_000);

  const events = settings?.calendar_ical_url
    ? await fetchIcalEvents(settings.calendar_ical_url, rangeStart, rangeEnd)
    : [];

  const couponExpiriesByDate = new Map<string, Array<{ id: string; name: string; imageUrl: string | null }>>();
  if (settings?.calendar_show_coupon_expiry) {
    const coupons = await getUserCoupons(c.env.DB, friend.id, { status: 'unused' });
    for (const coupon of coupons) {
      const expiresAt = new Date(coupon.expires_at);
      if (expiresAt.getTime() < rangeStart.getTime() || expiresAt.getTime() > rangeEnd.getTime()) continue;
      const dateKey = toJstDateString(expiresAt);
      const list = couponExpiriesByDate.get(dateKey) ?? [];
      list.push({ id: coupon.id, name: coupon.display_name, imageUrl: coupon.display_image_url });
      couponExpiriesByDate.set(dateKey, list);
    }
  }

  let cardExpiryDate: string | null = null;
  if (settings?.calendar_show_card_expiry) {
    const card = await getOrCreateUserCard(c.env.DB, friend.id, accountId);
    if (card.expires_at) {
      const expiresAt = new Date(card.expires_at);
      if (expiresAt.getTime() >= rangeStart.getTime() && expiresAt.getTime() <= rangeEnd.getTime()) {
        cardExpiryDate = toJstDateString(expiresAt);
      }
    }
  }

  return c.json({
    month: `${targetY}-${String(targetM + 1).padStart(2, '0')}`,
    canGoPrev: targetIndex > currentIndex,
    canGoNext: targetIndex < maxIndex,
    events,
    couponExpiries: Array.from(couponExpiriesByDate.entries()).map(([date, coupons]) => ({ date, coupons })),
    cardExpiryDate,
  });
});

// POST /api/liff/cards/:id/extend — 1回限定セルフ延長 (要件⑤)
cardCoupon.post('/api/liff/cards/:id/extend', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await resolveFriend(c, accountId, callerLineUserId);
  if (!friend) return bad(c, 'friend_not_found', 404);

  const card = await getUserCardById(c.env.DB, c.req.param('id'));
  if (!card || card.friend_id !== friend.id) return bad(c, 'not_found', 404);

  const settings = await getCardSettings(c.env.DB, accountId);
  if (settings?.card_expiry_self_extension_enabled === 0) return bad(c, 'self_extension_disabled', 403);

  const result = await extendUserCardExpiry(c.env.DB, card.id);
  const account = await getLineAccountById(c.env.DB, accountId);
  if (account) {
    if (result.extended) {
      await sendExtensionConfirmed(account.channel_access_token, callerLineUserId);
    } else {
      await sendExtensionAlreadyUsed(account.channel_access_token, callerLineUserId);
    }
  }

  if (!result.extended) return bad(c, 'already_extended', 409);
  return c.json({ success: true, newExpiresAt: result.newExpiresAt });
});

// POST /api/liff/coupons/:id/extend — 1回限定セルフ延長 (要件⑤)
cardCoupon.post('/api/liff/coupons/:id/extend', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await resolveFriend(c, accountId, callerLineUserId);
  if (!friend) return bad(c, 'friend_not_found', 404);

  const coupon = await getUserCouponById(c.env.DB, c.req.param('id'));
  if (!coupon || coupon.friend_id !== friend.id) return bad(c, 'not_found', 404);

  const result = await extendUserCouponExpiry(c.env.DB, coupon.id);
  const account = await getLineAccountById(c.env.DB, accountId);
  if (account) {
    if (result.extended) {
      await sendExtensionConfirmed(account.channel_access_token, callerLineUserId);
    } else {
      await sendExtensionAlreadyUsed(account.channel_access_token, callerLineUserId);
    }
  }

  if (!result.extended) return bad(c, result.error === 'already_used' ? 'already_used' : 'already_extended', 409);
  return c.json({ success: true, newExpiresAt: result.newExpiresAt });
});

export { cardCoupon };
