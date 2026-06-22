import { describe, it, expect } from 'vitest';
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

// 管理画面からの遠隔付与: 入力した数値そのものを正確に付与する (倍率ルール・記念日ボーナスは無視)。
describe('grantStamp: skipMultiplier bypasses all multiplier sources', () => {
  const accountId = 'acc-1';
  const friendId = 'friend-1';

  it('ignores an active manual multiplier rule when skipMultiplier is true', async () => {
    const db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();
    await db.prepare(`INSERT INTO point_multiplier_rules (id, line_account_id, name, multiplier, condition_type, is_active) VALUES ('rule-1', ?, 'テスト2倍', 2, 'manual', 1)`).bind(accountId).run();

    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'manual', manualBasePoints: 5, skipMultiplier: true });

    expect(result.finalPoints).toBe(5);
    expect(result.card.stamp_count).toBe(5);
  });

  it('ignores the friend anniversary bonus when skipMultiplier is true', async () => {
    const db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id, created_at) VALUES (?, 'Uxxxx', '2024-01-31T00:00:00.000+09:00')`).bind(friendId).run();
    await db.prepare(
      `INSERT INTO card_settings (line_account_id, rank_enabled, friend_anniversary_multiplier_enabled, friend_anniversary_multiplier_value) VALUES (?, 0, 1, 1.5)`,
    ).bind(accountId).run();

    const { grantStamp } = await import('../src/stamp-cards.js');
    // 2026-04-30 JST はこの友だちの (1/31基準・繰上げ後の) 記念日
    const result = await grantStamp(db, {
      friendId, lineAccountId: accountId, source: 'manual', manualBasePoints: 3, skipMultiplier: true,
      now: new Date('2026-04-29T15:00:00.000Z'),
    });

    expect(result.finalPoints).toBe(3);
  });

  it('without skipMultiplier, the same rule still applies as before (regression guard)', async () => {
    const db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();
    await db.prepare(`INSERT INTO point_multiplier_rules (id, line_account_id, name, multiplier, condition_type, is_active) VALUES ('rule-1', ?, 'テスト2倍', 2, 'manual', 1)`).bind(accountId).run();

    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'manual', manualBasePoints: 5 });

    expect(result.finalPoints).toBe(10);
  });
});
