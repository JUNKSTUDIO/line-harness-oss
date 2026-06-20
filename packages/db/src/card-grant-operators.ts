import { jstNow } from './utils.js';

// QRスタンプ付与の不正利用防止 — 事前登録されたLINEアカウントのみ付与を許可する。

export interface CardGrantOperatorRow {
  id: string;
  line_account_id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  registered_at: string;
}

export async function isAuthorizedGrantOperator(db: D1Database, lineAccountId: string, lineUserId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM card_grant_operators WHERE line_account_id = ? AND line_user_id = ?`)
    .bind(lineAccountId, lineUserId)
    .first();
  return !!row;
}

export async function registerGrantOperator(
  db: D1Database,
  params: { lineAccountId: string; lineUserId: string; displayName: string | null; pictureUrl: string | null },
): Promise<CardGrantOperatorRow> {
  const existing = await db
    .prepare(`SELECT * FROM card_grant_operators WHERE line_account_id = ? AND line_user_id = ?`)
    .bind(params.lineAccountId, params.lineUserId)
    .first<CardGrantOperatorRow>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO card_grant_operators (id, line_account_id, line_user_id, display_name, picture_url, registered_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, params.lineAccountId, params.lineUserId, params.displayName, params.pictureUrl, jstNow())
    .run();
  return (await db.prepare(`SELECT * FROM card_grant_operators WHERE id = ?`).bind(id).first<CardGrantOperatorRow>())!;
}

export async function getGrantOperators(db: D1Database, lineAccountId: string): Promise<CardGrantOperatorRow[]> {
  const result = await db
    .prepare(`SELECT * FROM card_grant_operators WHERE line_account_id = ? ORDER BY registered_at DESC`)
    .bind(lineAccountId)
    .all<CardGrantOperatorRow>();
  return result.results;
}

export async function removeGrantOperator(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM card_grant_operators WHERE id = ?`).bind(id).run();
}
