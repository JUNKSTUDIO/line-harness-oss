import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function loadDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  return db;
}

function seedAccountAndFriend(db: Database.Database) {
  db.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('acc-1', 'ch-1', 'Test Shop', 'token', 'secret')`,
  ).run();
  db.prepare(`INSERT INTO friends (id, line_user_id) VALUES ('friend-1', 'Uxxxx')`).run();
}

describe('046_stamp_card_coupon_system.sql', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = loadDb();
    seedAccountAndFriend(db);
  });

  it('creates all expected tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const expected of [
      'card_settings',
      'card_ranks',
      'point_multiplier_rules',
      'user_cards',
      'stamp_logs',
      'coupon_templates',
      'user_coupons',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('rejects an invalid stamp_rule_type via CHECK constraint', () => {
    expect(() =>
      db
        .prepare(`INSERT INTO card_settings (line_account_id, stamp_rule_type) VALUES ('acc-1', 'bogus')`)
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('requires amount_per_stamp when stamp_rule_type = per_amount', () => {
    expect(() =>
      db
        .prepare(`INSERT INTO card_settings (line_account_id, stamp_rule_type) VALUES ('acc-1', 'per_amount')`)
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO card_settings (line_account_id, stamp_rule_type, amount_per_stamp) VALUES ('acc-1', 'per_amount', 1000)`,
        )
        .run(),
    ).not.toThrow();
  });

  it('cascades friend deletion to user_cards (ON DELETE CASCADE)', () => {
    db.prepare(`INSERT INTO user_cards (id, friend_id, line_account_id) VALUES ('card-1', 'friend-1', 'acc-1')`).run();
    db.prepare(`DELETE FROM friends WHERE id = 'friend-1'`).run();
    const remaining = db.prepare(`SELECT COUNT(*) AS c FROM user_cards`).get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  // 「1回限定の1週間セルフ延長」(要件⑤、超重要) — 二重延長がDBレベルで
  // 防止されることを、実際に使う原子的UPDATE文そのもので検証する。
  describe('one-time self-extension (expiration_extended guard)', () => {
    it('user_cards: first extension succeeds, second is a no-op (0 rows changed)', () => {
      const expiresAt = '2026-07-01T00:00:00.000Z';
      db.prepare(
        `INSERT INTO user_cards (id, friend_id, line_account_id, expires_at) VALUES ('card-1', 'friend-1', 'acc-1', ?)`,
      ).run(expiresAt);

      const update = db.prepare(
        `UPDATE user_cards SET expires_at = ?, expiration_extended = 1 WHERE id = ? AND expiration_extended = 0`,
      );
      const newExpiresAt = '2026-07-08T00:00:00.000Z';

      const first = update.run(newExpiresAt, 'card-1');
      expect(first.changes).toBe(1);

      const row1 = db.prepare(`SELECT expires_at, expiration_extended FROM user_cards WHERE id = 'card-1'`).get() as {
        expires_at: string;
        expiration_extended: number;
      };
      expect(row1.expires_at).toBe(newExpiresAt);
      expect(row1.expiration_extended).toBe(1);

      // 2回目: フラグが既に1なのでWHERE節にマッチせず、0行更新で終わる。
      const second = update.run('2026-07-15T00:00:00.000Z', 'card-1');
      expect(second.changes).toBe(0);

      const row2 = db.prepare(`SELECT expires_at FROM user_cards WHERE id = 'card-1'`).get() as { expires_at: string };
      expect(row2.expires_at).toBe(newExpiresAt); // 変化していない
    });

    it('user_coupons: first extension succeeds, second is a no-op (0 rows changed)', () => {
      db.prepare(
        `INSERT INTO coupon_templates (id, line_account_id, name, validity_days) VALUES ('tpl-1', 'acc-1', 'テストクーポン', 30)`,
      ).run();
      const expiresAt = '2026-07-01T00:00:00.000Z';
      db.prepare(
        `INSERT INTO user_coupons (id, friend_id, coupon_template_id, line_account_id, expires_at) VALUES ('coupon-1', 'friend-1', 'tpl-1', 'acc-1', ?)`,
      ).run(expiresAt);

      const update = db.prepare(
        `UPDATE user_coupons SET expires_at = ?, expiration_extended = 1 WHERE id = ? AND expiration_extended = 0`,
      );

      const first = update.run('2026-07-08T00:00:00.000Z', 'coupon-1');
      expect(first.changes).toBe(1);

      const second = update.run('2026-07-15T00:00:00.000Z', 'coupon-1');
      expect(second.changes).toBe(0);

      const row = db.prepare(`SELECT expires_at FROM user_coupons WHERE id = 'coupon-1'`).get() as { expires_at: string };
      expect(row.expires_at).toBe('2026-07-08T00:00:00.000Z');
    });
  });
});
