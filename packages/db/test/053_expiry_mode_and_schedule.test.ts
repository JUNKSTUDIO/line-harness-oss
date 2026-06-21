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

// card_expiry_mode 等はALTER追加列のため (慣習により) schema.sqlには折り込まれていない。
// bootstrap.sql (schema.sql + 全migrationsの累積) を使う必要がある。
function loadDb(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return wrapD1(sqlite);
}

describe('card_expiry_mode: since_issue vs since_last_stamp', () => {
  let db: D1Database;
  const accountId = 'acc-1';
  const friendId = 'friend-1';

  beforeEach(async () => {
    db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();
  });

  it('since_issue: expiry stays anchored to the original issue date across multiple grants', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    await db.prepare(`INSERT INTO card_settings (line_account_id, rank_enabled, card_expiry_mode, card_expiry_days_from_issue) VALUES (?, 0, 'since_issue', 30)`).bind(accountId).run();

    const day1 = new Date('2026-01-01T00:00:00.000Z');
    const first = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', now: day1 });
    const expectedExpiry = new Date(first.card.created_at).getTime() + 30 * 24 * 3600_000;
    expect(new Date(first.card.expires_at!).getTime()).toBeCloseTo(expectedExpiry, -2);

    // 10日後にもう一度来店しても、期限は発行日基準のまま変わらない
    const day11 = new Date('2026-01-11T00:00:00.000Z');
    const second = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', now: day11 });
    expect(second.card.expires_at).toBe(first.card.expires_at);
  });

  it('since_last_stamp: expiry extends from the latest stamp date on every grant', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    await db.prepare(`INSERT INTO card_settings (line_account_id, rank_enabled, card_expiry_mode, card_expiry_months) VALUES (?, 0, 'since_last_stamp', 1)`).bind(accountId).run();

    const day1 = new Date('2026-01-01T00:00:00.000Z');
    const first = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', now: day1 });
    expect(new Date(first.card.expires_at!).toISOString().slice(0, 10)).toBe('2026-02-01');

    const day20 = new Date('2026-01-20T00:00:00.000Z');
    const second = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', now: day20 });
    expect(new Date(second.card.expires_at!).toISOString().slice(0, 10)).toBe('2026-02-20');
  });
});

describe('resolveActiveMultiplier: day_of_month condition', () => {
  it('matches only when JST date-of-month equals the configured day', async () => {
    const { resolveActiveMultiplier } = await import('../src/stamp-cards.js');
    const rules = [
      {
        id: 'rule-1', line_account_id: 'acc-1', name: '5日は2倍', multiplier: 2, condition_type: 'day_of_month' as const,
        weekday: null, day_of_month: 5, time_start: null, time_end: null, starts_at: null, ends_at: null,
        weather_condition: null, is_active: 1, priority: 0, created_at: '', updated_at: '',
      },
    ];

    // 2026-01-05T01:00:00Z + 9h = 2026-01-05T10:00 JST -> day_of_month=5 と一致
    const onDay = resolveActiveMultiplier(rules, new Date('2026-01-05T01:00:00.000Z'));
    expect(onDay.multiplier).toBe(2);

    // 2026-01-05T16:00:00Z + 9h = 2026-01-06T01:00 JST -> day_of_month=5とは一致しない
    const nextDay = resolveActiveMultiplier(rules, new Date('2026-01-05T16:00:00.000Z'));
    expect(nextDay.multiplier).toBe(1);
  });
});
