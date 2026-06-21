import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function wrapD1(db: Database.Database) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              const info = stmt.run(...args);
              return { meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...args) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...args) as T[] };
            },
          };
        },
        async first<T>() {
          return (stmt.get() as T) ?? null;
        },
        async all<T>() {
          return { results: stmt.all() as T[] };
        },
      };
    },
  } as unknown as D1Database;
}

function loadDb(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return wrapD1(sqlite);
}

describe('redeemCoupon: single_use vs unlimited_in_period', () => {
  let db: D1Database;
  const accountId = 'acc-1';
  const friendId = 'friend-1';
  const farFuture = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();

  beforeEach(async () => {
    db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();
    await db.prepare(`INSERT INTO coupon_templates (id, line_account_id, name, validity_days) VALUES ('tpl-1', ?, 'テストクーポン', 30)`).bind(accountId).run();
  });

  it('single_use: the first redeem succeeds and flips status to used; a second redeem fails', async () => {
    const { redeemCoupon } = await import('../src/coupons.js');
    await db.prepare(
      `INSERT INTO user_coupons (id, friend_id, line_account_id, coupon_template_id, issued_via, expires_at, usage_policy)
       VALUES ('c1', ?, ?, 'tpl-1', 'manual', ?, 'single_use')`,
    ).bind(friendId, accountId, farFuture).run();

    const first = await redeemCoupon(db, 'c1', null);
    expect(first).toEqual({ success: true });

    const second = await redeemCoupon(db, 'c1', null);
    expect(second.success).toBe(false);
    expect(second.error).toBe('already_used');
  });

  it('unlimited_in_period: status stays unused and every redeem succeeds, incrementing a count', async () => {
    const { redeemCoupon, countCouponRedemptions } = await import('../src/coupons.js');
    await db.prepare(
      `INSERT INTO user_coupons (id, friend_id, line_account_id, coupon_template_id, issued_via, expires_at, usage_policy)
       VALUES ('c1', ?, ?, 'tpl-1', 'manual', ?, 'unlimited_in_period')`,
    ).bind(friendId, accountId, farFuture).run();

    const first = await redeemCoupon(db, 'c1', null);
    expect(first).toEqual({ success: true, redemptionCount: 1 });

    const second = await redeemCoupon(db, 'c1', null);
    expect(second).toEqual({ success: true, redemptionCount: 2 });

    expect(await countCouponRedemptions(db, 'c1')).toBe(2);
  });

  it('rejects an expired coupon regardless of usage_policy', async () => {
    const { redeemCoupon } = await import('../src/coupons.js');
    const past = new Date(Date.now() - 24 * 3600_000).toISOString();
    await db.prepare(
      `INSERT INTO user_coupons (id, friend_id, line_account_id, coupon_template_id, issued_via, expires_at, usage_policy)
       VALUES ('c1', ?, ?, 'tpl-1', 'manual', ?, 'unlimited_in_period')`,
    ).bind(friendId, accountId, past).run();

    const result = await redeemCoupon(db, 'c1', null);
    expect(result).toEqual({ success: false, error: 'expired' });
  });
});

describe('issueCoupon: snapshots the template usage_policy at issuance', () => {
  it('copies unlimited_in_period onto the issued coupon row', async () => {
    const db = loadDb();
    const accountId = 'acc-1';
    const friendId = 'friend-1';
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();
    await db.prepare(
      `INSERT INTO coupon_templates (id, line_account_id, name, validity_days, usage_policy) VALUES ('tpl-1', ?, '誕生月クーポン', 30, 'unlimited_in_period')`,
    ).bind(accountId).run();

    const { issueCoupon } = await import('../src/coupons.js');
    const coupon = await issueCoupon(db, { friendId, lineAccountId: accountId, couponTemplateId: 'tpl-1', issuedVia: 'campaign' });
    expect(coupon.usage_policy).toBe('unlimited_in_period');
  });
});
