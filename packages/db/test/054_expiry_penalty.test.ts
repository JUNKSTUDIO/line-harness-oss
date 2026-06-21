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

describe('grantStamp: expiry penalty modes (applied at the moment an expired card revives)', () => {
  let db: D1Database;
  const accountId = 'acc-1';
  const friendId = 'friend-1';
  let bronzeId: string;
  let silverId: string;
  let goldId: string;

  beforeEach(async () => {
    db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();

    bronzeId = 'rank-bronze';
    silverId = 'rank-silver';
    goldId = 'rank-gold';
    await db.prepare(`INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps) VALUES (?, ?, 'ブロンズ', 0, 5)`).bind(bronzeId, accountId).run();
    await db.prepare(`INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps) VALUES (?, ?, 'シルバー', 1, 10)`).bind(silverId, accountId).run();
    await db.prepare(`INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps) VALUES (?, ?, 'ゴールド', 2, 20)`).bind(goldId, accountId).run();
  });

  async function seedExpiredGoldCard(penaltyType: string, targetRankId: string | null = null) {
    await db.prepare(
      `INSERT INTO card_settings (line_account_id, rank_enabled, card_expiry_penalty_type, card_expiry_penalty_target_rank_id) VALUES (?, 1, ?, ?)`,
    ).bind(accountId, penaltyType, targetRankId).run();
    await db.prepare(
      `INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count, status, expiration_extended, created_at)
       VALUES ('card-1', ?, ?, ?, 6, 'expired', 1, '2025-01-01T00:00:00.000+09:00')`,
    ).bind(friendId, accountId, goldId).run();
  }

  it("'none': expired card revives with progress fully intact", async () => {
    await seedExpiredGoldCard('none');
    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(result.card.current_rank_id).toBe(goldId);
    expect(result.card.stamp_count).toBe(7);
    expect(result.card.status).toBe('active');
  });

  it("'reset_to_start': drops back to the first rank with stamp_count reset to 0 before granting", async () => {
    await seedExpiredGoldCard('reset_to_start');
    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(result.card.current_rank_id).toBe(bronzeId);
    expect(result.card.stamp_count).toBe(1); // 0 + このスタンプの1
  });

  it("'drop_one_level': moves exactly one rank down from where they were (gold -> silver)", async () => {
    await seedExpiredGoldCard('drop_one_level');
    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(result.card.current_rank_id).toBe(silverId);
    expect(result.card.stamp_count).toBe(1);
  });

  it("'drop_to_rank': moves to the specifically configured rank regardless of how high they were", async () => {
    await seedExpiredGoldCard('drop_to_rank', bronzeId);
    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(result.card.current_rank_id).toBe(bronzeId);
    expect(result.card.stamp_count).toBe(1);
  });

  it("'reissue': resets rank/stamps, clears the one-time extension flag, and restarts the issue date", async () => {
    await seedExpiredGoldCard('reissue');
    const { grantStamp } = await import('../src/stamp-cards.js');
    const now = new Date('2026-03-01T00:00:00.000Z');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', now });
    expect(result.card.current_rank_id).toBe(bronzeId);
    expect(result.card.stamp_count).toBe(1);
    expect(result.card.expiration_extended).toBe(0);
    expect(result.card.created_at.slice(0, 10)).toBe('2026-03-01');
  });

  it('an already-active card is never touched by penalty logic, even with a penalty configured', async () => {
    await db.prepare(
      `INSERT INTO card_settings (line_account_id, rank_enabled, card_expiry_penalty_type) VALUES (?, 1, 'reset_to_start')`,
    ).bind(accountId).run();
    await db.prepare(
      `INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count, status) VALUES ('card-1', ?, ?, ?, 6, 'active')`,
    ).bind(friendId, accountId, goldId).run();
    const { grantStamp } = await import('../src/stamp-cards.js');
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(result.card.current_rank_id).toBe(goldId);
    expect(result.card.stamp_count).toBe(7);
  });
});
