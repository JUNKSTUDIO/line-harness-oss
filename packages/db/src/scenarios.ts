import { jstNow } from './utils.js';
import { computeNextDeliveryAt } from './scenario-schedule.js';
export type ScenarioTriggerType = 'friend_add' | 'tag_added' | 'manual';
export type MessageType = 'text' | 'image' | 'flex';
export type FriendScenarioStatus = 'active' | 'paused' | 'completed';
export type DeliveryMode = 'relative' | 'elapsed' | 'absolute_time';

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  trigger_type: ScenarioTriggerType;
  trigger_tag_id: string | null;
  line_account_id: string | null;
  is_active: number;
  delivery_mode: DeliveryMode;
  created_at: string;
  updated_at: string;
}

export interface ScenarioStep {
  id: string;
  scenario_id: string;
  step_order: number;
  delay_minutes: number;
  message_type: MessageType;
  message_content: string;
  condition_type: string | null;
  condition_value: string | null;
  next_step_on_false: number | null;
  offset_days: number | null;
  offset_minutes: number | null;
  delivery_time: string | null;
  template_id: string | null;
  on_reach_tag_id: string | null;
  /** 到達時に付与するスタンプ数 (倍率ルール等は適用せずこの数値をそのまま付与する) */
  on_reach_stamp_count: number | null;
  /** 到達時に発行するクーポンのテンプレートID */
  on_reach_coupon_template_id: string | null;
  /** relative モード限定: セットされていれば前ステップ配信時刻からNカレンダー日後のこの時刻 ("HH:MM") に配信する */
  pin_delivery_time: string | null;
  /** trueなら配信を常に6〜14分早める (予約配信と分かりづらくする)。falseなら既存の±5分対称ジッター */
  early_jitter_enabled: number;
  created_at: string;
}

export interface ScenarioWithSteps extends Scenario {
  steps: ScenarioStep[];
}

export interface FriendScenario {
  id: string;
  friend_id: string;
  scenario_id: string;
  current_step_order: number;
  status: FriendScenarioStatus;
  started_at: string;
  next_delivery_at: string | null;
  updated_at: string;
}

// ============================================================
// Scenario CRUD
// ============================================================

export type ScenarioWithStepCount = Scenario & { step_count: number };

export async function getScenarios(db: D1Database): Promise<ScenarioWithStepCount[]> {
  const result = await db
    .prepare(
      `SELECT s.*, COUNT(ss.id) as step_count
       FROM scenarios s
       LEFT JOIN scenario_steps ss ON s.id = ss.scenario_id
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
    )
    .all<ScenarioWithStepCount>();
  return result.results;
}

export async function getScenarioById(
  db: D1Database,
  id: string,
): Promise<ScenarioWithSteps | null> {
  const scenario = await db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>();

  if (!scenario) return null;

  const stepsResult = await db
    .prepare(
      `SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
    )
    .bind(id)
    .all<ScenarioStep>();

  return { ...scenario, steps: stepsResult.results };
}

export interface CreateScenarioInput {
  name: string;
  description?: string | null;
  triggerType: ScenarioTriggerType;
  triggerTagId?: string | null;
  deliveryMode?: DeliveryMode;
}

export async function createScenario(
  db: D1Database,
  input: CreateScenarioInput,
): Promise<Scenario> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO scenarios (id, name, description, trigger_type, trigger_tag_id, is_active, delivery_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.triggerType,
      input.triggerTagId ?? null,
      input.deliveryMode ?? 'relative',
      now,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>())!;
}

export type UpdateScenarioInput = Partial<
  Pick<Scenario, 'name' | 'description' | 'trigger_type' | 'trigger_tag_id' | 'is_active'>
>;

export async function updateScenario(
  db: D1Database,
  id: string,
  updates: UpdateScenarioInput,
): Promise<Scenario | null> {
  const now = jstNow();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.trigger_type !== undefined) {
    fields.push('trigger_type = ?');
    values.push(updates.trigger_type);
  }
  if (updates.trigger_tag_id !== undefined) {
    fields.push('trigger_tag_id = ?');
    values.push(updates.trigger_tag_id);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }

  if (fields.length === 0) {
    return db
      .prepare(`SELECT * FROM scenarios WHERE id = ?`)
      .bind(id)
      .first<Scenario>();
  }

  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  await db
    .prepare(`UPDATE scenarios SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>();
}

export async function deleteScenario(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scenarios WHERE id = ?`).bind(id).run();
}

// ============================================================
// Scenario Steps
// ============================================================

export interface CreateScenarioStepInput {
  scenarioId: string;
  stepOrder: number;
  delayMinutes?: number;
  messageType: MessageType;
  messageContent: string;
  conditionType?: string | null;
  conditionValue?: string | null;
  nextStepOnFalse?: number | null;
  offsetDays?: number | null;
  offsetMinutes?: number | null;
  deliveryTime?: string | null;
  templateId?: string | null;
  onReachTagId?: string | null;
  onReachStampCount?: number | null;
  onReachCouponTemplateId?: string | null;
  pinDeliveryTime?: string | null;
  earlyJitterEnabled?: boolean;
}

export async function createScenarioStep(
  db: D1Database,
  input: CreateScenarioStepInput,
): Promise<ScenarioStep> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO scenario_steps
       (id, scenario_id, step_order, delay_minutes, message_type, message_content,
        condition_type, condition_value, next_step_on_false,
        offset_days, offset_minutes, delivery_time,
        template_id, on_reach_tag_id, on_reach_stamp_count, on_reach_coupon_template_id,
        pin_delivery_time, early_jitter_enabled,
        created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.scenarioId,
      input.stepOrder,
      input.delayMinutes ?? 0,
      input.messageType,
      input.messageContent,
      input.conditionType ?? null,
      input.conditionValue ?? null,
      input.nextStepOnFalse ?? null,
      input.offsetDays ?? null,
      input.offsetMinutes ?? null,
      input.deliveryTime ?? null,
      input.templateId ?? null,
      input.onReachTagId ?? null,
      input.onReachStampCount ?? null,
      input.onReachCouponTemplateId ?? null,
      input.pinDeliveryTime ?? null,
      input.earlyJitterEnabled ? 1 : 0,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM scenario_steps WHERE id = ?`)
    .bind(id)
    .first<ScenarioStep>())!;
}

export type UpdateScenarioStepInput = Partial<
  Pick<
    ScenarioStep,
    | 'step_order'
    | 'delay_minutes'
    | 'message_type'
    | 'message_content'
    | 'condition_type'
    | 'condition_value'
    | 'next_step_on_false'
    | 'offset_days'
    | 'offset_minutes'
    | 'delivery_time'
    | 'template_id'
    | 'on_reach_tag_id'
    | 'on_reach_stamp_count'
    | 'on_reach_coupon_template_id'
    | 'pin_delivery_time'
    | 'early_jitter_enabled'
  >
>;

export async function updateScenarioStep(
  db: D1Database,
  id: string,
  updates: UpdateScenarioStepInput,
): Promise<ScenarioStep | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.step_order !== undefined) {
    fields.push('step_order = ?');
    values.push(updates.step_order);
  }
  if (updates.delay_minutes !== undefined) {
    fields.push('delay_minutes = ?');
    values.push(updates.delay_minutes);
  }
  if (updates.message_type !== undefined) {
    fields.push('message_type = ?');
    values.push(updates.message_type);
  }
  if (updates.message_content !== undefined) {
    fields.push('message_content = ?');
    values.push(updates.message_content);
  }
  if (updates.condition_type !== undefined) {
    fields.push('condition_type = ?');
    values.push(updates.condition_type);
  }
  if (updates.condition_value !== undefined) {
    fields.push('condition_value = ?');
    values.push(updates.condition_value);
  }
  if (updates.next_step_on_false !== undefined) {
    fields.push('next_step_on_false = ?');
    values.push(updates.next_step_on_false);
  }
  if (updates.offset_days !== undefined) {
    fields.push('offset_days = ?');
    values.push(updates.offset_days);
  }
  if (updates.offset_minutes !== undefined) {
    fields.push('offset_minutes = ?');
    values.push(updates.offset_minutes);
  }
  if (updates.delivery_time !== undefined) {
    fields.push('delivery_time = ?');
    values.push(updates.delivery_time);
  }
  if (updates.template_id !== undefined) {
    fields.push('template_id = ?');
    values.push(updates.template_id);
  }
  if (updates.on_reach_tag_id !== undefined) {
    fields.push('on_reach_tag_id = ?');
    values.push(updates.on_reach_tag_id);
  }
  if (updates.on_reach_stamp_count !== undefined) {
    fields.push('on_reach_stamp_count = ?');
    values.push(updates.on_reach_stamp_count);
  }
  if (updates.on_reach_coupon_template_id !== undefined) {
    fields.push('on_reach_coupon_template_id = ?');
    values.push(updates.on_reach_coupon_template_id);
  }
  if (updates.pin_delivery_time !== undefined) {
    fields.push('pin_delivery_time = ?');
    values.push(updates.pin_delivery_time);
  }
  if (updates.early_jitter_enabled !== undefined) {
    fields.push('early_jitter_enabled = ?');
    values.push(updates.early_jitter_enabled);
  }

  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE scenario_steps SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return db
    .prepare(`SELECT * FROM scenario_steps WHERE id = ?`)
    .bind(id)
    .first<ScenarioStep>();
}

export async function deleteScenarioStep(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scenario_steps WHERE id = ?`).bind(id).run();
}

export async function getScenarioSteps(
  db: D1Database,
  scenarioId: string,
): Promise<ScenarioStep[]> {
  const result = await db
    .prepare(
      `SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
    )
    .bind(scenarioId)
    .all<ScenarioStep>();
  return result.results;
}

// ============================================================
// Scenario Step Messages — 1ステップ内の複数フキダシ (LINE仕様上限5件/push)
// ============================================================

export interface ScenarioStepMessage {
  id: string;
  scenario_step_id: string;
  order_index: number;
  message_type: MessageType;
  message_content: string;
  template_id: string | null;
  created_at: string;
}

export const MAX_SCENARIO_STEP_MESSAGES = 5;

export async function getScenarioStepMessages(
  db: D1Database,
  scenarioStepId: string,
): Promise<ScenarioStepMessage[]> {
  const result = await db
    .prepare(`SELECT * FROM scenario_step_messages WHERE scenario_step_id = ? ORDER BY order_index ASC`)
    .bind(scenarioStepId)
    .all<ScenarioStepMessage>();
  return result.results;
}

/** シナリオ全体のステップ一覧表示用に、複数ステップ分のフキダシを一括取得する (N+1回避)。 */
export async function getScenarioStepMessagesByStepIds(
  db: D1Database,
  stepIds: string[],
): Promise<Map<string, ScenarioStepMessage[]>> {
  const map = new Map<string, ScenarioStepMessage[]>();
  if (stepIds.length === 0) return map;
  const placeholders = stepIds.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT * FROM scenario_step_messages WHERE scenario_step_id IN (${placeholders}) ORDER BY order_index ASC`)
    .bind(...stepIds)
    .all<ScenarioStepMessage>();
  for (const row of result.results) {
    const list = map.get(row.scenario_step_id) ?? [];
    list.push(row);
    map.set(row.scenario_step_id, list);
  }
  return map;
}

export interface ScenarioStepMessageInput {
  messageType: MessageType;
  messageContent: string;
  templateId?: string | null;
}

/** ステップのフキダシ一覧をまるごと置き換える (既存を削除して新しいリストを挿入、1ステップ最大5件)。 */
export async function replaceScenarioStepMessages(
  db: D1Database,
  scenarioStepId: string,
  messages: ScenarioStepMessageInput[],
): Promise<ScenarioStepMessage[]> {
  if (messages.length === 0) throw new Error('scenario step must have at least 1 message');
  if (messages.length > MAX_SCENARIO_STEP_MESSAGES) {
    throw new Error(`scenario step can have at most ${MAX_SCENARIO_STEP_MESSAGES} messages (LINE push limit)`);
  }

  const now = jstNow();
  const stmts = [
    db.prepare(`DELETE FROM scenario_step_messages WHERE scenario_step_id = ?`).bind(scenarioStepId),
    ...messages.map((m, i) =>
      db
        .prepare(
          `INSERT INTO scenario_step_messages (id, scenario_step_id, order_index, message_type, message_content, template_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), scenarioStepId, i, m.messageType, m.messageContent, m.templateId ?? null, now),
    ),
  ];
  await db.batch(stmts);

  return getScenarioStepMessages(db, scenarioStepId);
}

// ============================================================
// Friend Scenario Enrollments
// ============================================================

export async function enrollFriendInScenario(
  db: D1Database,
  friendId: string,
  scenarioId: string,
): Promise<FriendScenario | null> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // delivery_mode を取得（migration 037 適用前の DB では 'relative' が DEFAULT で既に入っている）
  const scenarioRow = await db
    .prepare(`SELECT delivery_mode FROM scenarios WHERE id = ?`)
    .bind(scenarioId)
    .first<{ delivery_mode: DeliveryMode }>();
  if (!scenarioRow) return null;

  const firstStep = await db
    .prepare(
      `SELECT step_order, delay_minutes, offset_days, offset_minutes, delivery_time, pin_delivery_time
       FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC LIMIT 1`,
    )
    .bind(scenarioId)
    .first<{
      step_order: number;
      delay_minutes: number;
      offset_days: number | null;
      offset_minutes: number | null;
      delivery_time: string | null;
      pin_delivery_time: string | null;
    }>();

  // A scenario with no steps is immediately completed — no stuck active enrollment.
  if (!firstStep) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
         VALUES (?, ?, ?, 0, 'completed', ?, NULL, ?)`,
      )
      .bind(id, friendId, scenarioId, now, now)
      .run();

    if (!result.meta.changes || result.meta.changes === 0) return null;

    return (await db
      .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
      .bind(id)
      .first<FriendScenario>())!;
  }

  const enrolledAtDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryDate = computeNextDeliveryAt(
    { delivery_mode: scenarioRow.delivery_mode },
    firstStep,
    { enrolledAt: enrolledAtDate, previousDeliveredAt: enrolledAtDate, now: enrolledAtDate },
  );
  const nextDeliveryAt = nextDeliveryDate.toISOString().slice(0, -1) + '+09:00';

  // current_step_order is initialized to -1 (NOT 0) so that the step-delivery
  // service's `steps.find(s => s.step_order > fs.current_step_order)` lookup
  // matches the very first step (step_order=0).
  // If we initialize to 0, scenarios that only have a step_order=0 step are
  // silently completed without delivering anything (because no step has
  // step_order > 0). This was observed in production on 2026-04-27 where
  // ~10 friend_scenarios silently completed for a 46-hour window.
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
       VALUES (?, ?, ?, -1, 'active', ?, ?, ?)`,
    )
    .bind(id, friendId, scenarioId, now, nextDeliveryAt, now)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) return null;

  return (await db
    .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
    .bind(id)
    .first<FriendScenario>())!;
}

export async function getFriendScenariosDueForDelivery(
  db: D1Database,
  now: string,
): Promise<FriendScenario[]> {
  // Fetch all active scenarios with a delivery time, then filter by epoch comparison
  // to handle mixed timestamp formats (Z and +09:00) during migration
  const result = await db
    .prepare(
      `SELECT fs.* FROM friend_scenarios fs
       INNER JOIN scenarios s ON fs.scenario_id = s.id
       WHERE fs.status = 'active'
         AND s.is_active = 1
         AND fs.next_delivery_at IS NOT NULL`,
    )
    .all<FriendScenario>();
  const nowMs = new Date(now).getTime();
  return result.results
    .filter((fs) => new Date(fs.next_delivery_at!).getTime() <= nowMs)
    .sort((a, b) => new Date(a.next_delivery_at!).getTime() - new Date(b.next_delivery_at!).getTime());
}

/**
 * Optimistic lock: claim a friend_scenario for delivery.
 * Only succeeds if status='active' and current_step_order matches.
 * Returns true if claimed, false if another worker already processed it.
 */
export async function claimFriendScenarioForDelivery(
  db: D1Database,
  id: string,
  expectedStepOrder: number,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'delivering', updated_at = ?
       WHERE id = ? AND status = 'active' AND current_step_order = ?`,
    )
    .bind(now, id, expectedStepOrder)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Crash recovery: reset friend_scenarios stuck in 'delivering' for over 5 minutes back to 'active'.
 */
export async function recoverStuckDeliveries(db: D1Database): Promise<number> {
  const fiveMinAgo = new Date(Date.now() + 9 * 60 * 60_000 - 5 * 60_000);
  const threshold = fiveMinAgo.toISOString().slice(0, -1) + '+09:00';
  const result = await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'active', updated_at = ?
       WHERE status = 'delivering' AND updated_at < ?`,
    )
    .bind(jstNow(), threshold)
    .run();
  return result.meta.changes ?? 0;
}

export async function advanceFriendScenario(
  db: D1Database,
  id: string,
  nextStepOrder: number,
  nextDeliveryAt?: string | null,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET current_step_order = ?,
           next_delivery_at = ?,
           status = 'active',
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextStepOrder, nextDeliveryAt ?? null, now, id)
    .run();
}

export async function completeFriendScenario(
  db: D1Database,
  id: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'completed',
           next_delivery_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, id)
    .run();
}
