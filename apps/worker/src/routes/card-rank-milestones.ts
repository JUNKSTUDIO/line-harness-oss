// ランク内マイルストーン報酬 (例: シルバー10個中5個でクーポン) — 管理画面向けエンドポイント。

import { Hono } from 'hono';
import { getCardRankMilestones, createCardRankMilestone, deleteCardRankMilestone } from '@line-crm/db';
import type { Env } from '../index.js';

const cardRankMilestones = new Hono<Env>();

// GET /api/card-rank-milestones?cardRankId=xxx
cardRankMilestones.get('/api/card-rank-milestones', async (c) => {
  const cardRankId = c.req.query('cardRankId');
  if (!cardRankId) return c.json({ success: false, error: 'cardRankId required' }, 400);
  const milestones = await getCardRankMilestones(c.env.DB, cardRankId);
  return c.json({ success: true, data: milestones });
});

// POST /api/card-rank-milestones
cardRankMilestones.post('/api/card-rank-milestones', async (c) => {
  const body = await c.req.json<{ cardRankId: string; stampThreshold: number; couponTemplateId: string }>();
  if (!body.cardRankId || !body.stampThreshold || !body.couponTemplateId) {
    return c.json({ success: false, error: 'cardRankId, stampThreshold, couponTemplateId required' }, 400);
  }
  const milestone = await createCardRankMilestone(c.env.DB, body);
  return c.json({ success: true, data: milestone }, 201);
});

// DELETE /api/card-rank-milestones/:id
cardRankMilestones.delete('/api/card-rank-milestones/:id', async (c) => {
  await deleteCardRankMilestone(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});

export { cardRankMilestones };
