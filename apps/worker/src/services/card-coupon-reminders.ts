// Cron handler: 「有効期限○日前」のスタンプカード/クーポン保持者を抽出し、
// 予約ボタン + 1回限定延長ボタン付きのリマインドを送る。
// booking-reminders.ts の processDueReminders と同じ「抽出 → 送信 → マーク」構造。

import {
  getCardsDueForExpiryReminder,
  markCardReminderSent,
  getCouponsDueForExpiryReminder,
  markCouponReminderSent,
} from '@line-crm/db';
import { sendExpiryReminder, resolveExtendLiffUrl, type ExpiryReminderKind } from './card-coupon-notifier.js';

function toJstDateOnly(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return jst.toISOString().slice(0, 10);
}

export type ExpiryReminderSender = typeof sendExpiryReminder;

export interface ProcessCardCouponRemindersParams {
  now: Date;
  envLiffUrl: string;
  /** テスト用に差し替え可能 (実体は sendExpiryReminder)。 */
  sender?: ExpiryReminderSender;
}

export async function processCardCouponExpiryReminders(
  db: D1Database,
  params: ProcessCardCouponRemindersParams,
): Promise<{ sent: number; failed: number }> {
  const sender = params.sender ?? sendExpiryReminder;
  let sent = 0;
  let failed = 0;

  const dueCards = await getCardsDueForExpiryReminder(db, params.now);
  for (const card of dueCards) {
    try {
      const extendLiffUrl = await resolveExtendLiffUrl(db, card.line_account_id, params.envLiffUrl, {
        kind: 'card' as ExpiryReminderKind,
        id: card.id,
      });
      await sender({
        channelAccessToken: card.channel_access_token,
        toLineUserId: card.line_user_id,
        fallbackLiffUrl: params.envLiffUrl,
        ctx: {
          kind: 'card',
          label: `現在のスタンプ数: ${card.stamp_count}pt`,
          expiresAtJst: toJstDateOnly(card.expires_at!),
          reservationUrl: card.reservation_url,
          extendLiffUrl,
          reservationButtonLabel: card.reminder_reservation_button_label,
          reservationHelperText: card.reminder_reservation_helper_text,
          extendButtonLabel: card.reminder_extend_button_label,
        },
      });
      await markCardReminderSent(db, card.id);
      sent++;
    } catch (e) {
      console.error('[card-coupon-reminders] card reminder failed', card.id, e);
      failed++;
    }
  }

  const dueCoupons = await getCouponsDueForExpiryReminder(db, params.now);
  for (const coupon of dueCoupons) {
    try {
      const extendLiffUrl = await resolveExtendLiffUrl(db, coupon.line_account_id, params.envLiffUrl, {
        kind: 'coupon' as ExpiryReminderKind,
        id: coupon.id,
      });
      await sender({
        channelAccessToken: coupon.channel_access_token,
        toLineUserId: coupon.line_user_id,
        fallbackLiffUrl: params.envLiffUrl,
        ctx: {
          kind: 'coupon',
          label: coupon.coupon_name,
          expiresAtJst: toJstDateOnly(coupon.expires_at),
          reservationUrl: coupon.reservation_url,
          extendLiffUrl,
          reservationButtonLabel: coupon.reminder_reservation_button_label,
          reservationHelperText: coupon.reminder_reservation_helper_text,
          extendButtonLabel: coupon.reminder_extend_button_label,
        },
      });
      await markCouponReminderSent(db, coupon.id);
      sent++;
    } catch (e) {
      console.error('[card-coupon-reminders] coupon reminder failed', coupon.id, e);
      failed++;
    }
  }

  return { sent, failed };
}
