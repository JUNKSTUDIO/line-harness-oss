import { jstNow } from './utils.js';

// ランクアップ式スタンプカード — クエリヘルパー

export interface CardSettingsRow {
  line_account_id: string;
  stamp_rule_type: 'per_visit' | 'per_amount';
  amount_per_stamp: number | null;
  signup_bonus_stamps: number;
  rank_enabled: number;
  flat_goal_stamps: number | null;
  card_expiry_months: number | null;
  default_coupon_validity_days: number;
  reminder_days_before: number;
  reservation_url: string | null;
  stamp_image_url: string | null;
  shop_latitude: number | null;
  shop_longitude: number | null;
  shop_address: string | null;
  weather_check_interval_minutes: number;
  weather_last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardRankRow {
  id: string;
  line_account_id: string;
  name: string;
  rank_order: number;
  max_stamps: number;
  reward_coupon_template_id: string | null;
  rich_menu_group_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PointMultiplierRuleRow {
  id: string;
  line_account_id: string;
  name: string;
  multiplier: number;
  condition_type: 'manual' | 'weekday' | 'time_range' | 'period' | 'weather';
  weekday: number | null;
  time_start: string | null;
  time_end: string | null;
  starts_at: string | null;
  ends_at: string | null;
  weather_condition: 'rain' | 'snow' | null;
  is_active: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface UserCardRow {
  id: string;
  friend_id: string;
  line_account_id: string;
  current_rank_id: string | null;
  stamp_count: number;
  total_stamp_count: number;
  last_stamped_at: string | null;
  expires_at: string | null;
  expiration_extended: number;
  status: 'active' | 'expired';
  expiry_reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

// --- card_settings ---

export async function getCardSettings(db: D1Database, lineAccountId: string): Promise<CardSettingsRow | null> {
  return db.prepare(`SELECT * FROM card_settings WHERE line_account_id = ?`).bind(lineAccountId).first<CardSettingsRow>();
}

export async function upsertCardSettings(
  db: D1Database,
  lineAccountId: string,
  input: Partial<Omit<CardSettingsRow, 'line_account_id' | 'created_at' | 'updated_at'>>,
): Promise<CardSettingsRow> {
  const now = jstNow();
  const existing = await getCardSettings(db, lineAccountId);
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO card_settings (
           line_account_id, stamp_rule_type, amount_per_stamp, signup_bonus_stamps,
           rank_enabled, flat_goal_stamps, card_expiry_months, default_coupon_validity_days,
           reminder_days_before, reservation_url, stamp_image_url, shop_latitude, shop_longitude,
           shop_address, weather_check_interval_minutes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        lineAccountId,
        input.stamp_rule_type ?? 'per_visit',
        input.amount_per_stamp ?? null,
        input.signup_bonus_stamps ?? 0,
        input.rank_enabled ?? 0,
        input.flat_goal_stamps ?? null,
        input.card_expiry_months ?? null,
        input.default_coupon_validity_days ?? 30,
        input.reminder_days_before ?? 3,
        input.reservation_url ?? null,
        input.stamp_image_url ?? null,
        input.shop_latitude ?? null,
        input.shop_longitude ?? null,
        input.shop_address ?? null,
        input.weather_check_interval_minutes ?? 30,
        now,
        now,
      )
      .run();
  } else {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const key of Object.keys(input) as Array<keyof typeof input>) {
      sets.push(`${key} = ?`);
      values.push(input[key]);
    }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      values.push(now, lineAccountId);
      await db.prepare(`UPDATE card_settings SET ${sets.join(', ')} WHERE line_account_id = ?`).bind(...values).run();
    }
  }
  return (await getCardSettings(db, lineAccountId))!;
}

/** 店舗位置情報が設定済み、かつ weather 型の倍率ルールを持つ card_settings を抽出 (天候自動連携の対象)。 */
export async function getCardSettingsWithWeatherLocation(db: D1Database): Promise<CardSettingsRow[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT cs.* FROM card_settings cs
         INNER JOIN point_multiplier_rules pmr ON pmr.line_account_id = cs.line_account_id AND pmr.condition_type = 'weather'
        WHERE cs.shop_latitude IS NOT NULL AND cs.shop_longitude IS NOT NULL`,
    )
    .all<CardSettingsRow>();
  return result.results;
}

export async function markWeatherChecked(db: D1Database, lineAccountId: string): Promise<void> {
  await db.prepare(`UPDATE card_settings SET weather_last_checked_at = ? WHERE line_account_id = ?`)
    .bind(jstNow(), lineAccountId).run();
}

// --- card_ranks ---

export async function getCardRanks(db: D1Database, lineAccountId: string): Promise<CardRankRow[]> {
  const result = await db
    .prepare(`SELECT * FROM card_ranks WHERE line_account_id = ? ORDER BY rank_order ASC`)
    .bind(lineAccountId)
    .all<CardRankRow>();
  return result.results;
}

export async function getCardRankById(db: D1Database, id: string): Promise<CardRankRow | null> {
  return db.prepare(`SELECT * FROM card_ranks WHERE id = ?`).bind(id).first<CardRankRow>();
}

/** 次のランク (rank_order + 1) を取得。最終ランクなら null。 */
export async function getNextCardRank(db: D1Database, lineAccountId: string, currentRankOrder: number): Promise<CardRankRow | null> {
  return db
    .prepare(`SELECT * FROM card_ranks WHERE line_account_id = ? AND rank_order = ? `)
    .bind(lineAccountId, currentRankOrder + 1)
    .first<CardRankRow>();
}

export interface CreateCardRankInput {
  lineAccountId: string;
  name: string;
  maxStamps: number;
  rewardCouponTemplateId?: string | null;
  richMenuGroupId?: string | null;
}

/** 新規ランクを末尾 (現在の最大rank_order + 1) に追加する。 */
export async function createCardRank(db: D1Database, input: CreateCardRankInput): Promise<CardRankRow> {
  const existing = await getCardRanks(db, input.lineAccountId);
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((r) => r.rank_order)) + 1 : 0;
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO card_ranks (id, line_account_id, name, rank_order, max_stamps, reward_coupon_template_id, rich_menu_group_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.lineAccountId, input.name, nextOrder, input.maxStamps, input.rewardCouponTemplateId ?? null, input.richMenuGroupId ?? null, now, now)
    .run();
  return (await getCardRankById(db, id))!;
}

export async function updateCardRank(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; maxStamps: number; rewardCouponTemplateId: string | null; richMenuGroupId: string | null }>,
): Promise<CardRankRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.maxStamps !== undefined) { sets.push('max_stamps = ?'); values.push(updates.maxStamps); }
  if (updates.rewardCouponTemplateId !== undefined) { sets.push('reward_coupon_template_id = ?'); values.push(updates.rewardCouponTemplateId); }
  if (updates.richMenuGroupId !== undefined) { sets.push('rich_menu_group_id = ?'); values.push(updates.richMenuGroupId); }
  if (sets.length === 0) return getCardRankById(db, id);
  sets.push('updated_at = ?');
  values.push(jstNow(), id);
  await db.prepare(`UPDATE card_ranks SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getCardRankById(db, id);
}

/** ランク削除。rank_orderは詰めない (欠番があっても getNextCardRank は次の rank_order+1 を素直に探すだけなので問題ない)。 */
export async function deleteCardRank(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM card_ranks WHERE id = ?`).bind(id).run();
}

// --- point_multiplier_rules ---

export async function getPointMultiplierRules(db: D1Database, lineAccountId: string): Promise<PointMultiplierRuleRow[]> {
  const result = await db
    .prepare(`SELECT * FROM point_multiplier_rules WHERE line_account_id = ? ORDER BY priority DESC`)
    .bind(lineAccountId)
    .all<PointMultiplierRuleRow>();
  return result.results;
}

export async function getPointMultiplierRuleById(db: D1Database, id: string): Promise<PointMultiplierRuleRow | null> {
  return db.prepare(`SELECT * FROM point_multiplier_rules WHERE id = ?`).bind(id).first<PointMultiplierRuleRow>();
}

export interface CreatePointMultiplierRuleInput {
  lineAccountId: string;
  name: string;
  multiplier: number;
  conditionType: PointMultiplierRuleRow['condition_type'];
  weekday?: number | null;
  timeStart?: string | null;
  timeEnd?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  weatherCondition?: PointMultiplierRuleRow['weather_condition'];
  priority?: number;
}

export async function createPointMultiplierRule(db: D1Database, input: CreatePointMultiplierRuleInput): Promise<PointMultiplierRuleRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO point_multiplier_rules (
         id, line_account_id, name, multiplier, condition_type, weekday, time_start, time_end,
         starts_at, ends_at, weather_condition, priority, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.lineAccountId, input.name, input.multiplier, input.conditionType,
      input.weekday ?? null, input.timeStart ?? null, input.timeEnd ?? null,
      input.startsAt ?? null, input.endsAt ?? null, input.weatherCondition ?? null,
      input.priority ?? 0, now, now,
    )
    .run();
  return (await getPointMultiplierRuleById(db, id))!;
}

export async function updatePointMultiplierRule(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string; multiplier: number; conditionType: PointMultiplierRuleRow['condition_type'];
    weekday: number | null; timeStart: string | null; timeEnd: string | null;
    startsAt: string | null; endsAt: string | null; weatherCondition: PointMultiplierRuleRow['weather_condition'];
    priority: number; isActive: boolean;
  }>,
): Promise<PointMultiplierRuleRow | null> {
  const colMap: Record<string, string> = {
    name: 'name', multiplier: 'multiplier', conditionType: 'condition_type', weekday: 'weekday',
    timeStart: 'time_start', timeEnd: 'time_end', startsAt: 'starts_at', endsAt: 'ends_at',
    weatherCondition: 'weather_condition', priority: 'priority',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(colMap)) {
    const value = (updates as Record<string, unknown>)[key];
    if (value !== undefined) { sets.push(`${col} = ?`); values.push(value); }
  }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return getPointMultiplierRuleById(db, id);
  sets.push('updated_at = ?');
  values.push(jstNow(), id);
  await db.prepare(`UPDATE point_multiplier_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getPointMultiplierRuleById(db, id);
}

export async function deletePointMultiplierRule(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM point_multiplier_rules WHERE id = ?`).bind(id).run();
}

export async function setMultiplierRuleActive(db: D1Database, id: string, isActive: boolean): Promise<void> {
  await db.prepare(`UPDATE point_multiplier_rules SET is_active = ?, updated_at = ? WHERE id = ?`)
    .bind(isActive ? 1 : 0, jstNow(), id).run();
}

/**
 * 現在時刻に成立する倍率ルールのうち、priority最大の1件を返す (乗算スタックしない)。
 * 「雨の日」等のweather型はis_active=1であることそのものが当日トグルの実体。
 */
export function resolveActiveMultiplier(rules: PointMultiplierRuleRow[], now: Date): { multiplier: number; ruleId: string | null } {
  const matching = rules.filter((rule) => {
    if (!rule.is_active) return false;
    switch (rule.condition_type) {
      case 'manual':
      case 'weather':
        return true; // is_active そのものが当日のON/OFF
      case 'weekday':
        return rule.weekday === now.getDay();
      case 'time_range': {
        if (!rule.time_start || !rule.time_end) return false;
        const hm = now.toTimeString().slice(0, 5);
        return hm >= rule.time_start && hm <= rule.time_end;
      }
      case 'period': {
        if (!rule.starts_at || !rule.ends_at) return false;
        return now.getTime() >= new Date(rule.starts_at).getTime() && now.getTime() <= new Date(rule.ends_at).getTime();
      }
      default:
        return false;
    }
  });
  if (matching.length === 0) return { multiplier: 1, ruleId: null };
  // priority DESC で取得済みのため先頭が最優先
  const top = matching[0];
  return { multiplier: top.multiplier, ruleId: top.id };
}

// --- user_cards ---

export async function getUserCard(db: D1Database, friendId: string, lineAccountId: string): Promise<UserCardRow | null> {
  return db
    .prepare(`SELECT * FROM user_cards WHERE friend_id = ? AND line_account_id = ?`)
    .bind(friendId, lineAccountId)
    .first<UserCardRow>();
}

export async function getUserCardById(db: D1Database, id: string): Promise<UserCardRow | null> {
  return db.prepare(`SELECT * FROM user_cards WHERE id = ?`).bind(id).first<UserCardRow>();
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

/** カード未発行なら発行 (発行時ボーナス込み)。既にあれば既存行を返す。 */
export async function getOrCreateUserCard(
  db: D1Database,
  friendId: string,
  lineAccountId: string,
): Promise<UserCardRow> {
  const existing = await getUserCard(db, friendId, lineAccountId);
  if (existing) return existing;

  const settings = await getCardSettings(db, lineAccountId);
  const bonus = settings?.signup_bonus_stamps ?? 0;
  const ranks = settings?.rank_enabled ? await getCardRanks(db, lineAccountId) : [];
  const firstRank = ranks[0] ?? null;

  const id = crypto.randomUUID();
  const now = jstNow();
  const nowIso = new Date().toISOString();
  const expiresAt = settings?.card_expiry_months ? addMonths(nowIso, settings.card_expiry_months) : null;

  await db
    .prepare(
      `INSERT INTO user_cards (
         id, friend_id, line_account_id, current_rank_id, stamp_count, total_stamp_count,
         last_stamped_at, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, friendId, lineAccountId, firstRank?.id ?? null, bonus, bonus, bonus > 0 ? nowIso : null, expiresAt, now, now)
    .run();

  return (await getUserCardById(db, id))!;
}

export interface GrantStampResult {
  card: UserCardRow;
  finalPoints: number;
  rankedUp: boolean;
  issuedCoupon: { templateId: string } | null;
}

/**
 * スタンプ付与。倍率を解決して final_points を計算し、stamp_logs に証跡を残し、
 * ランク到達時は次ランクへ進める (rank_enabled=0なら flat_goal_stamps を上限としてカウントのみ進める)。
 * 呼び出し側 (route/cron) は issuedCoupon が立った場合に coupons.ts の issueCoupon でクーポン発行し、
 * card_ranks.rich_menu_group_id があればリッチメニュー切替APIを呼ぶこと (本関数はDB更新のみ)。
 */
export async function grantStamp(
  db: D1Database,
  params: {
    friendId: string;
    lineAccountId: string;
    source: 'visit' | 'amount' | 'manual';
    amountYen?: number;
    grantedByStaffId?: string;
    now?: Date;
  },
): Promise<GrantStampResult> {
  const now = params.now ?? new Date();
  const settings = await getCardSettings(db, params.lineAccountId);
  const card = await getOrCreateUserCard(db, params.friendId, params.lineAccountId);

  // 基本付与pt: per_visit=1, per_amount=floor(amount / amount_per_stamp)
  let basePoints = 1;
  if (params.source === 'amount') {
    const unit = settings?.amount_per_stamp ?? 1000;
    basePoints = Math.floor((params.amountYen ?? 0) / unit);
  }

  const rules = await getPointMultiplierRules(db, params.lineAccountId);
  const { multiplier, ruleId } = resolveActiveMultiplier(rules, now);
  const finalPoints = Math.round(basePoints * multiplier);

  await db
    .prepare(
      `INSERT INTO stamp_logs (id, user_card_id, source, amount_yen, base_points, multiplier_applied, final_points, multiplier_rule_id, granted_by_staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), card.id, params.source, params.amountYen ?? null,
      basePoints, multiplier, finalPoints, ruleId, params.grantedByStaffId ?? null, jstNow(),
    )
    .run();

  let newStampCount = card.stamp_count + finalPoints;
  let newRankId = card.current_rank_id;
  let rankedUp = false;
  let issuedCoupon: { templateId: string } | null = null;

  const goal = settings?.rank_enabled
    ? (newRankId ? (await getCardRankById(db, newRankId))?.max_stamps ?? null : null)
    : settings?.flat_goal_stamps ?? null;

  if (goal != null && newStampCount >= goal) {
    if (settings?.rank_enabled && newRankId) {
      const currentRank = await getCardRankById(db, newRankId);
      if (currentRank?.reward_coupon_template_id) {
        issuedCoupon = { templateId: currentRank.reward_coupon_template_id };
      }
      const nextRank = currentRank ? await getNextCardRank(db, params.lineAccountId, currentRank.rank_order) : null;
      newStampCount = newStampCount - goal; // 超過分は次ランクに繰り越し
      newRankId = nextRank?.id ?? newRankId; // 最終ランクなら維持 (ゴール到達のまま据え置き)
      rankedUp = true;
    }
    // rank_enabled=0 (フラットゴール) はクリアしてもstamp_countを巻き戻さない —
    // 「あと◯個でクリア」表示は呼び出し側で goal との差分として算出する。
  }

  const nowIso = now.toISOString();
  const expiresAt = settings?.card_expiry_months ? addMonths(nowIso, settings.card_expiry_months) : null;

  await db
    .prepare(
      `UPDATE user_cards
         SET stamp_count = ?, total_stamp_count = total_stamp_count + ?, current_rank_id = ?,
             last_stamped_at = ?, expires_at = ?, status = 'active',
             expiry_reminder_sent_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(newStampCount, finalPoints, newRankId, nowIso, expiresAt, jstNow(), card.id)
    .run();

  return { card: (await getUserCardById(db, card.id))!, finalPoints, rankedUp, issuedCoupon };
}

/**
 * 期限1週間セルフ延長 (1回限定)。WHERE expiration_extended = 0 を含む原子的
 * UPDATE で二重延長を防止する。meta.changes が 0 なら「既に延長済み」。
 */
export async function extendUserCardExpiry(db: D1Database, cardId: string): Promise<{ extended: boolean; newExpiresAt: string | null }> {
  const card = await getUserCardById(db, cardId);
  if (!card || !card.expires_at) return { extended: false, newExpiresAt: card?.expires_at ?? null };

  const newExpiresAt = new Date(new Date(card.expires_at).getTime() + 7 * 24 * 3600_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE user_cards SET expires_at = ?, expiration_extended = 1, updated_at = ?
       WHERE id = ? AND expiration_extended = 0`,
    )
    .bind(newExpiresAt, jstNow(), cardId)
    .run();

  const changes = (result.meta as { changes?: number }).changes ?? 0;
  return { extended: changes > 0, newExpiresAt: changes > 0 ? newExpiresAt : card.expires_at };
}

/** 期限3日前 (設定値) のリマインド対象カードを抽出。 */
export async function getCardsDueForExpiryReminder(
  db: D1Database,
  now: Date,
): Promise<Array<UserCardRow & { line_user_id: string; channel_access_token: string; reservation_url: string | null; reminder_days_before: number }>> {
  const result = await db
    .prepare(
      `SELECT uc.*, f.line_user_id, la.channel_access_token, cs.reservation_url, cs.reminder_days_before
         FROM user_cards uc
         INNER JOIN friends f ON f.id = uc.friend_id
         INNER JOIN line_accounts la ON la.id = uc.line_account_id
         INNER JOIN card_settings cs ON cs.line_account_id = uc.line_account_id
        WHERE uc.status = 'active'
          AND uc.expiry_reminder_sent_at IS NULL
          AND uc.expires_at IS NOT NULL
          AND uc.expires_at <= datetime(?, '+' || cs.reminder_days_before || ' days')
          AND uc.expires_at > ?
        LIMIT 200`,
    )
    .bind(now.toISOString(), now.toISOString())
    .all<UserCardRow & { line_user_id: string; channel_access_token: string; reservation_url: string | null; reminder_days_before: number }>();
  return result.results;
}

export async function markCardReminderSent(db: D1Database, cardId: string): Promise<void> {
  await db.prepare(`UPDATE user_cards SET expiry_reminder_sent_at = ?, updated_at = ? WHERE id = ?`)
    .bind(jstNow(), jstNow(), cardId).run();
}

/** 期限切れカードを expired にする (6hごとのexpirer cronから呼ぶ)。 */
export async function expireOverdueCards(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(`UPDATE user_cards SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`)
    .bind(jstNow(), now.toISOString())
    .run();
  return (result.meta as { changes?: number }).changes ?? 0;
}
