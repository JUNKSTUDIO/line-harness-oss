// Cron handler: 誕生月クーポンの自動発行。card_settings.birthday_coupon_enabled なアカウントの
// 友だちで、今月が誕生月かつ今年まだ発行していない人にクーポンを発行し、お知らせのpushを送る。
// 有効期限はテンプレートの既定値ではなく「誕生月の末日 (JST 23:59:59)」に固定する。

import { getBirthdayCouponCandidates, markBirthdayCouponIssued, issueCoupon, getCouponTemplateById } from '@line-crm/db';
import { sendCouponIssuedNotification, type CouponIssuedSender } from './card-coupon-notifier.js';

const JST_OFFSET_MS = 9 * 60 * 60_000;

export interface ProcessBirthdayCouponsParams {
  now: Date;
  sender?: CouponIssuedSender;
}

function endOfMonthJstIso(year: number, month1to12: number): string {
  // month1to12+1 の 0日目 = その月の末日。JST 23:59:59.999 を UTC instant として表現する。
  const lastDayLocal = new Date(year, month1to12, 0).getDate();
  const utcMs = Date.UTC(year, month1to12 - 1, lastDayLocal, 23, 59, 59, 999) - JST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

export async function processBirthdayCoupons(
  db: D1Database,
  params: ProcessBirthdayCouponsParams,
): Promise<{ issued: number; failed: number }> {
  let issued = 0;
  let failed = 0;

  const jstNow = new Date(params.now.getTime() + JST_OFFSET_MS);
  const targetYear = jstNow.getUTCFullYear();
  const targetMonth = jstNow.getUTCMonth() + 1;
  const expiresAt = endOfMonthJstIso(targetYear, targetMonth);

  const candidates = await getBirthdayCouponCandidates(db, targetMonth, targetYear);
  for (const candidate of candidates) {
    try {
      const coupon = await issueCoupon(db, {
        friendId: candidate.friend_id,
        lineAccountId: candidate.line_account_id,
        couponTemplateId: candidate.birthday_coupon_template_id,
        issuedVia: 'campaign',
        expiresAtOverride: expiresAt,
      });
      await markBirthdayCouponIssued(db, {
        friendId: candidate.friend_id,
        lineAccountId: candidate.line_account_id,
        year: targetYear,
        issuedCouponId: coupon.id,
      });
      const template = await getCouponTemplateById(db, candidate.birthday_coupon_template_id);
      await sendCouponIssuedNotification({
        db,
        channelAccessToken: candidate.channel_access_token,
        toLineUserId: candidate.line_user_id,
        liffId: candidate.liff_id,
        messageTemplateId: template?.message_template_id ?? null,
        fallbackText: `お誕生日おめでとうございます🎉「${coupon.coupon_name_at_issuance ?? 'クーポン'}」を誕生月クーポンとして発行しました。今月中ぜひご利用ください。`,
        coupon: {
          name: coupon.coupon_name_at_issuance ?? 'クーポン',
          imageUrl: coupon.coupon_image_url_at_issuance,
          expiresAtJst: new Date(coupon.expires_at).toLocaleDateString('ja-JP'),
        },
        sender: params.sender,
      });
      issued++;
    } catch (e) {
      console.error('[birthday-coupon-issuer] issue failed', candidate.friend_id, e);
      failed++;
    }
  }

  return { issued, failed };
}
