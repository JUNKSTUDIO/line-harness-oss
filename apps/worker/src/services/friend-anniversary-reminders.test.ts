import { describe, expect, test } from 'vitest';
import { processFriendAnniversaryReminders, DEFAULT_FRIEND_ANNIVERSARY_REMINDER_MESSAGE } from './friend-anniversary-reminders.js';

interface CandidateRow {
  friend_id: string;
  line_account_id: string;
  line_user_id: string;
  channel_access_token: string;
  friend_created_at: string;
  friend_anniversary_reminder_message: string | null;
  last_sent_month: string | null;
}

function stubDB(candidates: CandidateRow[]) {
  const marked: Array<{ friendId: string; lineAccountId: string; yearMonth: string }> = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all() {
          if (sql.includes('FROM user_cards')) return { results: candidates };
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO friend_anniversary_reminders')) {
            marked.push({ friendId: bound[0] as string, lineAccountId: bound[1] as string, yearMonth: bound[2] as string });
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, marked };
}

// 2024-01-31 に友だち追加 -> 4月(30日まで)の記念日は4月30日。3日前の4月27日にリマインドが届く想定。
const candidateJan31: CandidateRow = {
  friend_id: 'friend-1',
  line_account_id: 'acc-1',
  line_user_id: 'Uxxxx',
  channel_access_token: 'tok',
  friend_created_at: '2024-01-31T00:00:00.000+09:00',
  friend_anniversary_reminder_message: null,
  last_sent_month: null,
};

describe('processFriendAnniversaryReminders', () => {
  test('sends the default templated message 3 days before the rolled-over anniversary day', async () => {
    const { db, marked } = stubDB([candidateJan31]);
    const sent: Array<{ to: string; text: string }> = [];
    const result = await processFriendAnniversaryReminders(db, {
      now: new Date('2026-04-26T15:00:00.000Z'), // JST 4/27 00:00 -> +3日後は4/30 JST
      sendPush: async (_token, to, text) => { sent.push({ to, text }); },
    });
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual([{ to: 'Uxxxx', text: DEFAULT_FRIEND_ANNIVERSARY_REMINDER_MESSAGE.replace('{day}', '30') }]);
    expect(marked).toEqual([{ friendId: 'friend-1', lineAccountId: 'acc-1', yearMonth: '2026-04' }]);
  });

  test('does not send when the target date is not within 3 days of the anniversary', async () => {
    const { db, marked } = stubDB([candidateJan31]);
    const sent: unknown[] = [];
    const result = await processFriendAnniversaryReminders(db, {
      now: new Date('2026-04-01T00:00:00.000Z'),
      sendPush: async () => { sent.push(1); },
    });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });

  test('skips a candidate already reminded this month, and uses a custom admin message template', async () => {
    const { db, marked } = stubDB([
      { ...candidateJan31, last_sent_month: '2026-04', friend_anniversary_reminder_message: 'カスタム文言: {day}日です' },
    ]);
    const sent: Array<{ text: string }> = [];
    const result = await processFriendAnniversaryReminders(db, {
      now: new Date('2026-04-26T15:00:00.000Z'),
      sendPush: async (_token, _to, text) => { sent.push({ text }); },
    });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });

  test('uses the custom admin-configured message when not yet sent this month', async () => {
    const { db } = stubDB([{ ...candidateJan31, friend_anniversary_reminder_message: 'カスタム文言: {day}日です' }]);
    const sent: Array<{ text: string }> = [];
    await processFriendAnniversaryReminders(db, {
      now: new Date('2026-04-26T15:00:00.000Z'),
      sendPush: async (_token, _to, text) => { sent.push({ text }); },
    });
    expect(sent).toEqual([{ text: 'カスタム文言: 30日です' }]);
  });
});
