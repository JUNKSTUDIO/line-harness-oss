// Cron handler: 「友だち登録記念日ボーナス」が3日後に来るお客様へ、事前リマインドのテキストを送る。
// card-coupon-reminders.ts と同じ「抽出 → 送信 → マーク」構造。月が変わるたびにまた送れるよう、
// dedupは「今月すでに送ったか (friend_anniversary_reminders.last_sent_month)」で行う。

import {
  getFriendAnniversaryReminderCandidates,
  markFriendAnniversaryReminderSent,
  isFriendAnniversaryDate,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';

export const DEFAULT_FRIEND_ANNIVERSARY_REMINDER_MESSAGE = 'もうすぐ{day}日はあなただけのポイント倍率アップ日です！ぜひご来店ください🎉';

const JST_OFFSET_MS = 9 * 60 * 60_000;

export interface ProcessFriendAnniversaryRemindersParams {
  now: Date;
  /** テスト用に差し替え可能。 */
  sendPush?: (channelAccessToken: string, lineUserId: string, text: string) => Promise<unknown>;
}

export async function processFriendAnniversaryReminders(
  db: D1Database,
  params: ProcessFriendAnniversaryRemindersParams,
): Promise<{ sent: number; failed: number }> {
  const sendPush = params.sendPush ?? ((token: string, to: string, text: string) => new LineClient(token).pushTextMessage(to, text));
  let sent = 0;
  let failed = 0;

  const reminderTarget = new Date(params.now.getTime() + 3 * 24 * 3600_000);
  const jstReminderTarget = new Date(reminderTarget.getTime() + JST_OFFSET_MS);
  const targetYearMonth = `${jstReminderTarget.getUTCFullYear()}-${String(jstReminderTarget.getUTCMonth() + 1).padStart(2, '0')}`;
  const targetDay = jstReminderTarget.getUTCDate();

  const candidates = await getFriendAnniversaryReminderCandidates(db);
  for (const candidate of candidates) {
    if (candidate.last_sent_month === targetYearMonth) continue;
    if (!isFriendAnniversaryDate(candidate.friend_created_at, reminderTarget)) continue;

    try {
      const template = candidate.friend_anniversary_reminder_message || DEFAULT_FRIEND_ANNIVERSARY_REMINDER_MESSAGE;
      const text = template.replaceAll('{day}', String(targetDay));
      await sendPush(candidate.channel_access_token, candidate.line_user_id, text);
      await markFriendAnniversaryReminderSent(db, candidate.friend_id, candidate.line_account_id, targetYearMonth);
      sent++;
    } catch (e) {
      console.error('[friend-anniversary-reminders] reminder failed', candidate.friend_id, e);
      failed++;
    }
  }

  return { sent, failed };
}
