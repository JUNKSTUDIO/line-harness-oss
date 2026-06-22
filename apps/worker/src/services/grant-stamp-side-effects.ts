// grantStamp() の結果を受けて行う副作用 (ランク到達/マイルストーンのクーポン発行・通知、
// ランクアップ時のリッチメニュー切替) をまとめた共通処理。
// LIFF経由のQRスタンプ付与 (stamp-grant.ts) と、管理画面からの遠隔付与の両方から呼ばれる。
// grantStamp自体はDB更新のみを行い、LINEへの通知やリッチメニュー切替はここに集約する。

import { issueCoupon, getCouponTemplateById, recordMilestoneIssued, getLineAccountById, getFriendById, type GrantStampResult } from '@line-crm/db';
import { applyRankUpRichMenu } from './rank-rich-menu.js';
import { sendCouponIssuedNotification } from './card-coupon-notifier.js';

export interface GrantStampSideEffectsResult {
  milestoneCouponNames: string[];
}

export async function processGrantStampSideEffects(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  result: GrantStampResult,
): Promise<GrantStampSideEffectsResult> {
  const account = await getLineAccountById(db, lineAccountId);
  const friend = await getFriendById(db, friendId);

  if (result.issuedCoupon && account && friend) {
    const coupon = await issueCoupon(db, {
      friendId,
      lineAccountId,
      couponTemplateId: result.issuedCoupon.templateId,
      issuedVia: 'rank_clear',
      sourceUserCardId: result.card.id,
    });
    const template = await getCouponTemplateById(db, result.issuedCoupon.templateId);
    await sendCouponIssuedNotification({
      db,
      channelAccessToken: account.channel_access_token,
      toLineUserId: friend.line_user_id,
      liffId: account.liff_id,
      messageTemplateId: template?.message_template_id ?? null,
      fallbackText: `ランクアップおめでとうございます！クーポンを発行しました（有効期限: ${new Date(coupon.expires_at).toLocaleDateString('ja-JP')}まで）。`,
      coupon: {
        name: coupon.coupon_name_at_issuance ?? 'クーポン',
        imageUrl: coupon.coupon_image_url_at_issuance,
        expiresAtJst: new Date(coupon.expires_at).toLocaleDateString('ja-JP'),
      },
    });
  }

  if (result.rankedUp && account) {
    await applyRankUpRichMenu(db, account, friendId, result.card.current_rank_id);
  }

  // ランク内マイルストーン (例: 10個中5個でクーポン) — 今回の付与で新たに到達した分だけ発行する。
  const milestoneCouponNames: string[] = [];
  if (result.milestonesCrossed.length > 0 && account && friend) {
    for (const m of result.milestonesCrossed) {
      const coupon = await issueCoupon(db, {
        friendId,
        lineAccountId,
        couponTemplateId: m.couponTemplateId,
        issuedVia: 'rank_clear',
        sourceUserCardId: result.card.id,
      });
      await recordMilestoneIssued(db, { userCardId: result.card.id, milestoneId: m.milestoneId, issuedCouponId: coupon.id });
      milestoneCouponNames.push(coupon.coupon_name_at_issuance ?? 'クーポン');
      const template = await getCouponTemplateById(db, m.couponTemplateId);
      await sendCouponIssuedNotification({
        db,
        channelAccessToken: account.channel_access_token,
        toLineUserId: friend.line_user_id,
        liffId: account.liff_id,
        messageTemplateId: template?.message_template_id ?? null,
        fallbackText: `「${coupon.coupon_name_at_issuance ?? 'クーポン'}」を獲得しました！（有効期限: ${new Date(coupon.expires_at).toLocaleDateString('ja-JP')}まで）。`,
        coupon: {
          name: coupon.coupon_name_at_issuance ?? 'クーポン',
          imageUrl: coupon.coupon_image_url_at_issuance,
          expiresAtJst: new Date(coupon.expires_at).toLocaleDateString('ja-JP'),
        },
      });
    }
  }

  return { milestoneCouponNames };
}
