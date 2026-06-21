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

// upsertCardSettings の INSERT 分岐は列リストと bind() の位置引数を手動で対応させているため、
// 列を追加するたびに本当にズレなく書き込めるかを直接確認する (placeholder数のズレはTSの型では検出できない)。
describe('upsertCardSettings: first-time insert (no existing row)', () => {
  it('inserts with defaults and the new birthday/anniversary columns intact', async () => {
    const db = loadDb();
    const accountId = 'acc-1';
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();

    const { upsertCardSettings, getCardSettings } = await import('../src/stamp-cards.js');
    const created = await upsertCardSettings(db, accountId, { rank_enabled: 1 });

    expect(created.rank_enabled).toBe(1);
    expect(created.card_expiry_mode).toBe('since_last_stamp');
    expect(created.multiplier_combination_mode).toBe('highest_priority_only');
    expect(created.friend_anniversary_multiplier_enabled).toBe(0);
    expect(created.friend_anniversary_multiplier_value).toBe(1.5);
    expect(created.birthday_coupon_enabled).toBe(0);
    expect(created.birthday_coupon_template_id).toBeNull();

    // 2回目以降は UPDATE 分岐 (動的SET) を通る — 同じく問題なく動くことを確認。
    const updated = await upsertCardSettings(db, accountId, { birthday_coupon_enabled: 1, friend_anniversary_multiplier_value: 2 });
    expect(updated.birthday_coupon_enabled).toBe(1);
    expect(updated.friend_anniversary_multiplier_value).toBe(2);
    expect(updated.rank_enabled).toBe(1); // 既存値が保持される

    const fetched = await getCardSettings(db, accountId);
    expect(fetched?.birthday_coupon_enabled).toBe(1);
  });
});
