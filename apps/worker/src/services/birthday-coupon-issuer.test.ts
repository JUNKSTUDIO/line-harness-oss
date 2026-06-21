import { describe, expect, test } from 'vitest';
import { processBirthdayCoupons } from './birthday-coupon-issuer.js';

interface CandidateRow {
  friend_id: string;
  line_account_id: string;
  line_user_id: string;
  channel_access_token: string;
  birthday_coupon_template_id: string;
}

function stubDB(candidates: CandidateRow[]) {
  const inserted: Array<{ table: string; values: unknown[] }> = [];
  let issuedCoupon: Record<string, unknown> | null = null;
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
          if (sql.includes('INSERT INTO user_coupons')) {
            inserted.push({ table: 'user_coupons', values: bound });
            issuedCoupon = {
              id: bound[0], friend_id: bound[1], coupon_template_id: bound[2], line_account_id: bound[3],
              issued_via: bound[4], source_user_card_id: bound[5], issued_at: bound[6], expires_at: bound[7],
              status: 'unused', coupon_name_at_issuance: bound[8], coupon_description_at_issuance: bound[9],
              coupon_image_url_at_issuance: bound[10], usage_policy: bound[11], created_at: bound[12], updated_at: bound[13],
            };
          }
          if (sql.includes('INSERT INTO friend_birthday_coupon_log')) inserted.push({ table: 'friend_birthday_coupon_log', values: bound });
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes('FROM coupon_templates')) {
            return { id: 'tpl-1', name: '誕生月クーポン', description: null, image_url: null, usage_policy: 'single_use', validity_type: 'relative_days', validity_days: 30, absolute_expires_at: null };
          }
          if (sql.includes('FROM user_coupons')) return issuedCoupon;
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, inserted };
}

const candidate: CandidateRow = {
  friend_id: 'friend-1',
  line_account_id: 'acc-1',
  line_user_id: 'Uxxxx',
  channel_access_token: 'tok',
  birthday_coupon_template_id: 'tpl-1',
};

describe('processBirthdayCoupons', () => {
  test('issues a coupon expiring at the end of the current JST month and notifies the friend', async () => {
    const { db } = stubDB([candidate]);
    const sent: Array<{ to: string; text: string }> = [];
    const result = await processBirthdayCoupons(db, {
      now: new Date('2026-04-10T00:00:00.000Z'),
      sendPush: async (_token, to, text) => { sent.push({ to, text }); },
    });
    expect(result).toEqual({ issued: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('Uxxxx');
    expect(sent[0].text).toContain('誕生月クーポン');
  });

  test('reports a failure without throwing when sendPush rejects', async () => {
    const { db } = stubDB([candidate]);
    const result = await processBirthdayCoupons(db, {
      now: new Date('2026-04-10T00:00:00.000Z'),
      sendPush: async () => { throw new Error('push failed'); },
    });
    expect(result).toEqual({ issued: 0, failed: 1 });
  });

  test('does nothing when there are no candidates', async () => {
    const { db } = stubDB([]);
    const result = await processBirthdayCoupons(db, { now: new Date('2026-04-10T00:00:00.000Z') });
    expect(result).toEqual({ issued: 0, failed: 0 });
  });
});
