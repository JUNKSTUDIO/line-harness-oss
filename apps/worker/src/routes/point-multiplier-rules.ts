// ポイント倍率ルール管理 — 管理画面向けエンドポイント。

import { Hono } from 'hono';
import {
  getPointMultiplierRules,
  createPointMultiplierRule,
  updatePointMultiplierRule,
  deletePointMultiplierRule,
  setMultiplierRuleActive,
  type PointMultiplierRuleRow,
} from '@line-crm/db';
import type { Env } from '../index.js';

const pointMultiplierRules = new Hono<Env>();

// GET /api/point-multiplier-rules?accountId=xxx
pointMultiplierRules.get('/api/point-multiplier-rules', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const rules = await getPointMultiplierRules(c.env.DB, accountId);
  return c.json({ success: true, data: rules });
});

// POST /api/point-multiplier-rules
pointMultiplierRules.post('/api/point-multiplier-rules', async (c) => {
  const body = await c.req.json<{
    accountId: string;
    name: string;
    multiplier: number;
    conditionType: PointMultiplierRuleRow['condition_type'];
    weekday?: number | null;
    dayOfMonth?: number | null;
    timeStart?: string | null;
    timeEnd?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    weatherCondition?: PointMultiplierRuleRow['weather_condition'];
    priority?: number;
  }>();
  if (!body.accountId || !body.name || !body.multiplier || !body.conditionType) {
    return c.json({ success: false, error: 'accountId, name, multiplier, conditionType required' }, 400);
  }
  const rule = await createPointMultiplierRule(c.env.DB, {
    lineAccountId: body.accountId,
    name: body.name,
    multiplier: body.multiplier,
    conditionType: body.conditionType,
    weekday: body.weekday,
    dayOfMonth: body.dayOfMonth,
    timeStart: body.timeStart,
    timeEnd: body.timeEnd,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    weatherCondition: body.weatherCondition,
    priority: body.priority,
  });
  return c.json({ success: true, data: rule }, 201);
});

// PATCH /api/point-multiplier-rules/:id — フィールド更新。当日ON/OFFもこれで(isActiveのみ送る)。
pointMultiplierRules.patch('/api/point-multiplier-rules/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const rule = await updatePointMultiplierRule(c.env.DB, c.req.param('id'), body);
  if (!rule) return c.json({ success: false, error: 'not_found' }, 404);
  return c.json({ success: true, data: rule });
});

// POST /api/point-multiplier-rules/:id/toggle — 当日ON/OFFスイッチ専用 (要件④の「手動でON/OFF」)
pointMultiplierRules.post('/api/point-multiplier-rules/:id/toggle', async (c) => {
  const body = await c.req.json<{ isActive: boolean }>();
  await setMultiplierRuleActive(c.env.DB, c.req.param('id'), body.isActive);
  return c.json({ success: true, data: null });
});

// DELETE /api/point-multiplier-rules/:id
pointMultiplierRules.delete('/api/point-multiplier-rules/:id', async (c) => {
  await deletePointMultiplierRule(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});

export { pointMultiplierRules };
