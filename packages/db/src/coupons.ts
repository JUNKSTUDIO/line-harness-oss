import { jstNow } from './utils.js';

// クーポン管理 — クエリヘルパー

export interface CouponTemplateRow {
  id: string;
  line_account_id: string;
  name: string;
  description: string | null;
  validity_type: 'relative_days' | 'absolute_date';
  validity_days: number | null;
  absolute_expires_at: string | null;
  message_template_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface UserCouponRow {
  id: string;
  friend_id: string;
  coupon_template_id: string;
  line_account_id: string;
  issued_via: 'rank_clear' | 'manual' | 'campaign';
  source_user_card_id: string | null;
  status: 'unused' | 'used' | 'expired';
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_staff_id: string | null;
  expiration_extended: number;
  rescue_count: number;
  last_rescued_at: string | null;
  expiry_reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCouponTemplateById(db: D1Database, id: string): Promise<CouponTemplateRow | null> {
  return db.prepare(`SELECT * FROM coupon_templates WHERE id = ?`).bind(id).first<CouponTemplateRow>();
}

export interface CreateCouponTemplateInput {
  lineAccountId: string;
  name: string;
  description?: string | null;
  validityType: CouponTemplateRow['validity_type'];
  validityDays?: number | null;
  absoluteExpiresAt?: string | null;
  messageTemplateId?: string | null;
}

export async function createCouponTemplate(db: D1Database, input: CreateCouponTemplateInput): Promise<CouponTemplateRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO coupon_templates (id, line_account_id, name, description, validity_type, validity_days, absolute_expires_at, message_template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.lineAccountId, input.name, input.description ?? null, input.validityType,
      input.validityDays ?? null, input.absoluteExpiresAt ?? null, input.messageTemplateId ?? null, now, now,
    )
    .run();
  return (await getCouponTemplateById(db, id))!;
}

export async function updateCouponTemplate(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string; description: string | null; validityType: CouponTemplateRow['validity_type'];
    validityDays: number | null; absoluteExpiresAt: string | null; messageTemplateId: string | null; isActive: boolean;
  }>,
): Promise<CouponTemplateRow | null> {
  const colMap: Record<string, string> = {
    name: 'name', description: 'description', validityType: 'validity_type',
    validityDays: 'validity_days', absoluteExpiresAt: 'absolute_expires_at', messageTemplateId: 'message_template_id',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(colMap)) {
    const value = (updates as Record<string, unknown>)[key];
    if (value !== undefined) { sets.push(`${col} = ?`); values.push(value); }
  }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return getCouponTemplateById(db, id);
  sets.push('updated_at = ?');
  values.push(jstNow(), id);
  await db.prepare(`UPDATE coupon_templates SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getCouponTemplateById(db, id);
}

export async function deleteCouponTemplate(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM coupon_templates WHERE id = ?`).bind(id).run();
}

export async function getCouponTemplates(db: D1Database, lineAccountId: string): Promise<CouponTemplateRow[]> {
  const result = await db
    .prepare(`SELECT * FROM coupon_templates WHERE line_account_id = ? ORDER BY created_at DESC`)
    .bind(lineAccountId)
    .all<CouponTemplateRow>();
  return result.results;
}

function resolveExpiresAt(template: CouponTemplateRow, issuedAtIso: string): string {
  if (template.validity_type === 'absolute_date' && template.absolute_expires_at) {
    return template.absolute_expires_at;
  }
  const days = template.validity_days ?? 30;
  return new Date(new Date(issuedAtIso).getTime() + days * 24 * 3600_000).toISOString();
}

/** クーポン発行 (ランク到達時 / 手動 / キャンペーン)。 */
export async function issueCoupon(
  db: D1Database,
  params: {
    friendId: string;
    lineAccountId: string;
    couponTemplateId: string;
    issuedVia: 'rank_clear' | 'manual' | 'campaign';
    sourceUserCardId?: string;
  },
): Promise<UserCouponRow> {
  const template = await getCouponTemplateById(db, params.couponTemplateId);
  if (!template) throw new Error(`coupon_template not found: ${params.couponTemplateId}`);

  const id = crypto.randomUUID();
  const now = jstNow();
  const issuedAtIso = new Date().toISOString();
  const expiresAt = resolveExpiresAt(template, issuedAtIso);

  await db
    .prepare(
      `INSERT INTO user_coupons (
         id, friend_id, coupon_template_id, line_account_id, issued_via, source_user_card_id,
         issued_at, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, params.friendId, params.couponTemplateId, params.lineAccountId, params.issuedVia, params.sourceUserCardId ?? null, now, expiresAt, now, now)
    .run();

  return (await getUserCouponById(db, id))!;
}

export async function getUserCouponById(db: D1Database, id: string): Promise<UserCouponRow | null> {
  return db.prepare(`SELECT * FROM user_coupons WHERE id = ?`).bind(id).first<UserCouponRow>();
}

export async function getUserCoupons(
  db: D1Database,
  friendId: string,
  opts: { status?: UserCouponRow['status'] } = {},
): Promise<UserCouponRow[]> {
  const query = opts.status
    ? `SELECT * FROM user_coupons WHERE friend_id = ? AND status = ? ORDER BY expires_at ASC`
    : `SELECT * FROM user_coupons WHERE friend_id = ? ORDER BY expires_at ASC`;
  const stmt = opts.status ? db.prepare(query).bind(friendId, opts.status) : db.prepare(query).bind(friendId);
  const result = await stmt.all<UserCouponRow>();
  return result.results;
}

/** スタッフによる「消し込み」(使用済みへの変更)。期限切れ/使用済みは不可。 */
export async function markCouponUsed(db: D1Database, couponId: string, staffId: string): Promise<{ success: boolean; error?: string }> {
  const coupon = await getUserCouponById(db, couponId);
  if (!coupon) return { success: false, error: 'not_found' };
  if (coupon.status !== 'unused') return { success: false, error: `already_${coupon.status}` };
  if (new Date(coupon.expires_at).getTime() <= Date.now()) return { success: false, error: 'expired' };

  await db
    .prepare(`UPDATE user_coupons SET status = 'used', used_at = ?, used_by_staff_id = ?, updated_at = ? WHERE id = ? AND status = 'unused'`)
    .bind(jstNow(), staffId, jstNow(), couponId)
    .run();
  return { success: true };
}

/**
 * 期限1週間セルフ延長 (1回限定)。WHERE expiration_extended = 0 を含む原子的
 * UPDATE で二重延長を防止する。meta.changes が 0 なら「既に延長済み」。
 * 既に使用済み/期限切れのクーポンは対象外。
 */
export async function extendUserCouponExpiry(db: D1Database, couponId: string): Promise<{ extended: boolean; newExpiresAt: string | null; error?: string }> {
  const coupon = await getUserCouponById(db, couponId);
  if (!coupon) return { extended: false, newExpiresAt: null, error: 'not_found' };
  if (coupon.status === 'used') return { extended: false, newExpiresAt: coupon.expires_at, error: 'already_used' };

  const newExpiresAt = new Date(new Date(coupon.expires_at).getTime() + 7 * 24 * 3600_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE user_coupons SET expires_at = ?, expiration_extended = 1, status = 'unused', updated_at = ?
       WHERE id = ? AND expiration_extended = 0`,
    )
    .bind(newExpiresAt, jstNow(), couponId)
    .run();

  const changes = (result.meta as { changes?: number }).changes ?? 0;
  if (changes === 0) return { extended: false, newExpiresAt: coupon.expires_at, error: 'already_extended' };
  return { extended: true, newExpiresAt };
}

/**
 * 管理者による手動救済 (要件③: 期限切れクーポンの復活/再設定)。セルフ延長と異なり
 * 何度でも実行可能 — rescue_count をインクリメントして履歴に残す。
 */
export async function rescueCoupon(
  db: D1Database,
  couponId: string,
  params: { extendDays: number },
): Promise<UserCouponRow> {
  const newExpiresAt = new Date(Date.now() + params.extendDays * 24 * 3600_000).toISOString();
  await db
    .prepare(
      `UPDATE user_coupons
         SET status = 'unused', expires_at = ?, rescue_count = rescue_count + 1, last_rescued_at = ?,
             expiry_reminder_sent_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(newExpiresAt, jstNow(), jstNow(), couponId)
    .run();
  return (await getUserCouponById(db, couponId))!;
}

/** 期限切れクーポン保持者の検索 (管理画面: 手動救済フォーム向け)。 */
export async function findExpiredCouponHolders(
  db: D1Database,
  lineAccountId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Array<UserCouponRow & { display_name: string | null; line_user_id: string; coupon_name: string }>> {
  const result = await db
    .prepare(
      `SELECT uc.*, f.display_name, f.line_user_id, ct.name AS coupon_name
         FROM user_coupons uc
         INNER JOIN friends f ON f.id = uc.friend_id
         INNER JOIN coupon_templates ct ON ct.id = uc.coupon_template_id
        WHERE uc.line_account_id = ? AND uc.status = 'expired'
        ORDER BY uc.expires_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(lineAccountId, opts.limit ?? 50, opts.offset ?? 0)
    .all<UserCouponRow & { display_name: string | null; line_user_id: string; coupon_name: string }>();
  return result.results;
}

/** 期限○日前 (テンプレート設定値) のリマインド対象クーポンを抽出。 */
export async function getCouponsDueForExpiryReminder(
  db: D1Database,
  now: Date,
): Promise<Array<UserCouponRow & { line_user_id: string; channel_access_token: string; reservation_url: string | null; coupon_name: string; reminder_days_before: number }>> {
  const result = await db
    .prepare(
      `SELECT uc.*, f.line_user_id, la.channel_access_token, cs.reservation_url, ct.name AS coupon_name, cs.reminder_days_before
         FROM user_coupons uc
         INNER JOIN friends f ON f.id = uc.friend_id
         INNER JOIN line_accounts la ON la.id = uc.line_account_id
         INNER JOIN coupon_templates ct ON ct.id = uc.coupon_template_id
         INNER JOIN card_settings cs ON cs.line_account_id = uc.line_account_id
        WHERE uc.status = 'unused'
          AND uc.expiry_reminder_sent_at IS NULL
          AND uc.expires_at <= datetime(?, '+' || cs.reminder_days_before || ' days')
          AND uc.expires_at > ?
        LIMIT 200`,
    )
    .bind(now.toISOString(), now.toISOString())
    .all<UserCouponRow & { line_user_id: string; channel_access_token: string; reservation_url: string | null; coupon_name: string; reminder_days_before: number }>();
  return result.results;
}

export async function markCouponReminderSent(db: D1Database, couponId: string): Promise<void> {
  await db.prepare(`UPDATE user_coupons SET expiry_reminder_sent_at = ?, updated_at = ? WHERE id = ?`)
    .bind(jstNow(), jstNow(), couponId).run();
}

/** 期限切れクーポンを expired にする (6hごとのexpirer cronから呼ぶ)。 */
export async function expireOverdueCoupons(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(`UPDATE user_coupons SET status = 'expired', updated_at = ? WHERE status = 'unused' AND expires_at <= ?`)
    .bind(jstNow(), now.toISOString())
    .run();
  return (result.meta as { changes?: number }).changes ?? 0;
}
