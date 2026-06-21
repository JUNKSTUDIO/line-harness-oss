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

// 報告されたバグ: シルバー -> ゴールドへランクアップする際、その繰越分だけで
// ゴールド側の「1個達成」マイルストーンを満たしてしまうケースでクーポンが発行されない。
describe('grantStamp: milestone on the new rank, triggered by the same grant that ranks up', () => {
  let db: D1Database;
  const accountId = 'acc-1';
  const friendId = 'friend-1';
  let silverId: string;
  let goldId: string;
  let templateId: string;

  beforeEach(async () => {
    db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();
    await db.prepare(`INSERT INTO card_settings (line_account_id, rank_enabled) VALUES (?, 1)`).bind(accountId).run();

    silverId = 'rank-silver';
    goldId = 'rank-gold';
    templateId = 'tpl-1';
    await db.prepare(`INSERT INTO coupon_templates (id, line_account_id, name, validity_days) VALUES (?, ?, 'ゴールド1個特典', 14)`).bind(templateId, accountId).run();
    await db.prepare(`INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps) VALUES (?, ?, 'シルバー', 0, 10)`).bind(silverId, accountId).run();
    await db.prepare(`INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps) VALUES (?, ?, 'ゴールド', 1, 20)`).bind(goldId, accountId).run();
    // ゴールド側に「1個達成」のマイルストーンを設定
    await db.prepare(`INSERT INTO card_rank_milestones (id, card_rank_id, stamp_threshold, coupon_template_id) VALUES ('m-gold-1', ?, 1, ?)`).bind(goldId, templateId).run();
  });

  it('fires the new rank milestone when the rank-up carry-over alone satisfies it', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    // シルバー 9.5/10、+2.0 付与 -> rawNewCount=11.5 -> ランクアップ、ゴールドへの繰越=1.5 (>= 1)
    await db.prepare(
      `INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count) VALUES ('card-1', ?, ?, ?, 9.5)`,
    ).bind(friendId, accountId, silverId).run();

    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', manualBasePoints: 2 });

    expect(result.rankedUp).toBe(true);
    expect(result.card.current_rank_id).toBe(goldId);
    expect(result.card.stamp_count).toBe(1.5);
    expect(result.milestonesCrossed).toEqual([{ milestoneId: 'm-gold-1', couponTemplateId: templateId }]);
  });

  it('does not fire the new rank milestone when the carry-over does not reach it', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    // シルバー 9.5/10、+1.0 付与 -> 繰越=0.5 (< 1) -> まだ届かない
    await db.prepare(
      `INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count) VALUES ('card-1', ?, ?, ?, 9.5)`,
    ).bind(friendId, accountId, silverId).run();

    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', manualBasePoints: 1 });

    expect(result.rankedUp).toBe(true);
    expect(result.card.stamp_count).toBe(0.5);
    expect(result.milestonesCrossed).toEqual([]);
  });

  it('still fires the new rank milestone on a later, separate grant after ranking up with no carry-over', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    await db.prepare(
      `INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count) VALUES ('card-1', ?, ?, ?, 9)`,
    ).bind(friendId, accountId, silverId).run();

    const rankUp = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', manualBasePoints: 1 });
    expect(rankUp.rankedUp).toBe(true);
    expect(rankUp.card.stamp_count).toBe(0);
    expect(rankUp.milestonesCrossed).toEqual([]);

    const nextVisit = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', manualBasePoints: 1 });
    expect(nextVisit.card.current_rank_id).toBe(goldId);
    expect(nextVisit.milestonesCrossed).toEqual([{ milestoneId: 'm-gold-1', couponTemplateId: templateId }]);
  });

  it('does not double-fire the new rank milestone once already recorded', async () => {
    const { grantStamp, recordMilestoneIssued } = await import('../src/stamp-cards.js');
    await db.prepare(
      `INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count) VALUES ('card-1', ?, ?, ?, 9.5)`,
    ).bind(friendId, accountId, silverId).run();

    const first = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', manualBasePoints: 2 });
    expect(first.milestonesCrossed).toEqual([{ milestoneId: 'm-gold-1', couponTemplateId: templateId }]);
    await recordMilestoneIssued(db, { userCardId: 'card-1', milestoneId: 'm-gold-1', issuedCouponId: null });

    const second = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit', manualBasePoints: 1 });
    expect(second.milestonesCrossed).toEqual([]);
  });
});
