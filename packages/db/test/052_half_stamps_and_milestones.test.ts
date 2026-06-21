import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

// D1Database の最小限のスタブ。grantStamp が使う prepare().bind().run()/.first()/.all() のみ実装する。
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
  sqlite.exec(readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  return wrapD1(sqlite);
}

describe('grantStamp: half-stamps and rank milestones', () => {
  let db: D1Database;
  const accountId = 'acc-1';
  const friendId = 'friend-1';
  let bronzeId: string;
  let silverId: string;
  let templateId: string;

  beforeEach(async () => {
    db = loadDb();
    await db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, 'ch-1', 'Shop', 'tok', 'sec')`).bind(accountId).run();
    await db.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, 'Uxxxx')`).bind(friendId).run();
    await db.prepare(`INSERT INTO card_settings (line_account_id, rank_enabled) VALUES (?, 1)`).bind(accountId).run();

    bronzeId = 'rank-bronze';
    silverId = 'rank-silver';
    templateId = 'tpl-1';
    await db.prepare(`INSERT INTO coupon_templates (id, line_account_id, name, validity_days) VALUES (?, ?, 'ミニ特典', 14)`).bind(templateId, accountId).run();
    await db.prepare(`INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps) VALUES (?, ?, 'ブロンズ', 0, 5)`).bind(bronzeId, accountId).run();
    await db.prepare(`INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps) VALUES (?, ?, 'シルバー', 1, 10)`).bind(silverId, accountId).run();
    await db.prepare(`INSERT INTO card_rank_milestones (id, card_rank_id, stamp_threshold, coupon_template_id) VALUES ('m-1', ?, 5, ?)`).bind(silverId, templateId).run();
  });

  it('rounds a 1.5x multiplier visit to a half-stamp (3 -> 4.5), not a rounded integer', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    await db.prepare(`INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count) VALUES ('card-1', ?, ?, ?, 3)`).bind(friendId, accountId, silverId).run();
    await db.prepare(`INSERT INTO point_multiplier_rules (id, line_account_id, name, multiplier, condition_type, is_active) VALUES ('rule-1', ?, '1.5倍テスト', 1.5, 'manual', 1)`).bind(accountId).run();

    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });

    expect(result.finalPoints).toBe(1.5);
    expect(result.card.stamp_count).toBe(4.5);
  });

  it('detects crossing a rank milestone and does not re-detect it once recorded', async () => {
    const { grantStamp, recordMilestoneIssued } = await import('../src/stamp-cards.js');
    // 4 -> 4.5 はしきい値5を跨がない
    await db.prepare(`INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count) VALUES ('card-1', ?, ?, ?, 4)`).bind(friendId, accountId, silverId).run();
    await db.prepare(`INSERT INTO point_multiplier_rules (id, line_account_id, name, multiplier, condition_type, is_active) VALUES ('rule-1', ?, '1.5倍テスト', 1.5, 'manual', 1)`).bind(accountId).run();

    const first = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(first.card.stamp_count).toBe(5.5);
    expect(first.milestonesCrossed).toEqual([{ milestoneId: 'm-1', couponTemplateId: templateId }]);

    // 呼び出し側が記録する想定の処理を模してマーク
    await recordMilestoneIssued(db, { userCardId: 'card-1', milestoneId: 'm-1', issuedCouponId: null });

    // もう一度付与しても、既に記録済みなので再検出しない
    const second = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(second.milestonesCrossed).toEqual([]);
  });

  it('carries the remainder into the next rank on rank-up (half-stamp aware)', async () => {
    const { grantStamp } = await import('../src/stamp-cards.js');
    await db.prepare(`INSERT INTO user_cards (id, friend_id, line_account_id, current_rank_id, stamp_count) VALUES ('card-1', ?, ?, ?, 4)`).bind(friendId, accountId, bronzeId).run();
    await db.prepare(`INSERT INTO point_multiplier_rules (id, line_account_id, name, multiplier, condition_type, is_active) VALUES ('rule-1', ?, '1.5倍テスト', 1.5, 'manual', 1)`).bind(accountId).run();

    // ブロンズ: max_stamps=5。4 + 1.5 = 5.5 -> ランクアップし、繰越は 0.5
    const result = await grantStamp(db, { friendId, lineAccountId: accountId, source: 'visit' });
    expect(result.rankedUp).toBe(true);
    expect(result.card.current_rank_id).toBe(silverId);
    expect(result.card.stamp_count).toBe(0.5);
  });
});
