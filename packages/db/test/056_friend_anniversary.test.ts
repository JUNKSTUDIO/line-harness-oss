import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFriendAnniversaryDate, resolveActiveMultiplier, type PointMultiplierRuleRow } from '../src/stamp-cards.js';

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

describe('isFriendAnniversaryDate: month-end rollover', () => {
  it('matches the same day-of-month in a normal month', () => {
    expect(isFriendAnniversaryDate('2024-03-15T00:00:00.000+09:00', new Date('2026-06-14T15:00:00.000Z'))).toBe(true); // 6/15 JST
    expect(isFriendAnniversaryDate('2024-03-15T00:00:00.000+09:00', new Date('2026-06-13T15:00:00.000Z'))).toBe(false); // 6/14 JST
  });

  it('rolls a 31st-of-month anniversary back to the last day of a 30-day month', () => {
    // 友だち追加日が1月31日 -> 4月(30日まで)の記念日は4月30日になる
    const joined = '2024-01-31T00:00:00.000+09:00';
    expect(isFriendAnniversaryDate(joined, new Date('2026-04-29T15:00:00.000Z'))).toBe(true); // 4/30 JST
    expect(isFriendAnniversaryDate(joined, new Date('2026-04-30T15:00:00.000Z'))).toBe(false); // 5/1 JST
  });

  it('rolls a 31st-of-month anniversary back to Feb 28 in a non-leap year', () => {
    const joined = '2024-01-31T00:00:00.000+09:00';
    expect(isFriendAnniversaryDate(joined, new Date('2026-02-27T15:00:00.000Z'))).toBe(true); // 2/28 JST, 2026 not leap
  });
});

describe('resolveActiveMultiplier: friend anniversary bonus interaction', () => {
  const now = new Date('2026-06-21T03:00:00.000Z');

  it('highest_priority_only: a real matching rule wins over the anniversary bonus', () => {
    const rules: PointMultiplierRuleRow[] = [
      { id: 'rain', line_account_id: 'a', name: '雨の日2倍', multiplier: 2, condition_type: 'manual', weekday: null, day_of_month: null, time_start: null, time_end: null, starts_at: null, ends_at: null, weather_condition: null, is_active: 1, priority: 0, created_at: '', updated_at: '' },
    ];
    const result = resolveActiveMultiplier(rules, now, 'highest_priority_only', { name: 'ご登録記念日ボーナス', multiplier: 1.5 });
    expect(result.multiplier).toBe(2);
  });

  it('highest_priority_only: the anniversary bonus applies alone when no other rule matches', () => {
    const result = resolveActiveMultiplier([], now, 'highest_priority_only', { name: 'ご登録記念日ボーナス', multiplier: 1.5 });
    expect(result.multiplier).toBe(1.5);
    expect(result.ruleId).toBeNull();
  });

  it('multiply_all: the anniversary bonus combines with other matching rules (2 * 1.5 = 3)', () => {
    const rules: PointMultiplierRuleRow[] = [
      { id: 'rain', line_account_id: 'a', name: '雨の日2倍', multiplier: 2, condition_type: 'manual', weekday: null, day_of_month: null, time_start: null, time_end: null, starts_at: null, ends_at: null, weather_condition: null, is_active: 1, priority: 0, created_at: '', updated_at: '' },
    ];
    const result = resolveActiveMultiplier(rules, now, 'multiply_all', { name: 'ご登録記念日ボーナス', multiplier: 1.5 });
    expect(result.multiplier).toBe(3);
  });

  it('no bonus and no rules: multiplier stays 1', () => {
    const result = resolveActiveMultiplier([], now, 'multiply_all', null);
    expect(result.multiplier).toBe(1);
  });
});

describe('grantStamp: applies the friend anniversary bonus on the rolled-over day', () => {
  let db: D1Database;
  const accountId = 'acc-1';
  const friendId = 'friend-1';

  beforeEach(async () => {
    db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    // 友だち追加日: 2024-01-31 (created_at をその日付に固定するため明示的にINSERT)
    await db.prepare(`INSERT INTO friends (id, line_user_id, created_at) VALUES (?, 'Uxxxx', '2024-01-31T00:00:00.000+09:00')`).bind(friendId).run();
    await db.prepare(
      `INSERT INTO card_settings (line_account_id, rank_enabled, friend_anniversary_multiplier_enabled, friend_anniversary_multiplier_value)
       VALUES (?, 0, 1, 1.5)`,
    ).bind(accountId).run();
  });

  it('applies 1.5x on the rolled-over anniversary day (Apr 30, since Jan 31 has no Apr 31)', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', now: new Date('2026-04-29T15:00:00.000Z') }); // 4/30 JST
    expect(result.finalPoints).toBe(1.5);
  });

  it('does not apply on a non-anniversary day', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', now: new Date('2026-04-28T15:00:00.000Z') }); // 4/29 JST
    expect(result.finalPoints).toBe(1);
  });
});
