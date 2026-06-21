// カードランク管理 — 管理画面向けエンドポイント。

import { Hono } from 'hono';
import { getCardRanks, createCardRank, updateCardRank, deleteCardRank, reorderCardRanks } from '@line-crm/db';
import type { Env } from '../index.js';

const cardRanks = new Hono<Env>();

// GET /api/card-ranks?accountId=xxx
cardRanks.get('/api/card-ranks', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const ranks = await getCardRanks(c.env.DB, accountId);
  return c.json({ success: true, data: ranks });
});

// POST /api/card-ranks
cardRanks.post('/api/card-ranks', async (c) => {
  const body = await c.req.json<{
    accountId: string;
    name: string;
    maxStamps: number;
    rewardCouponTemplateId?: string | null;
    richMenuGroupId?: string | null;
  }>();
  if (!body.accountId || !body.name || !body.maxStamps) {
    return c.json({ success: false, error: 'accountId, name, maxStamps required' }, 400);
  }
  const rank = await createCardRank(c.env.DB, {
    lineAccountId: body.accountId,
    name: body.name,
    maxStamps: body.maxStamps,
    rewardCouponTemplateId: body.rewardCouponTemplateId,
    richMenuGroupId: body.richMenuGroupId,
  });
  return c.json({ success: true, data: rank }, 201);
});

// PATCH /api/card-ranks/:id
cardRanks.patch('/api/card-ranks/:id', async (c) => {
  const body = await c.req.json<{
    name?: string;
    maxStamps?: number;
    rewardCouponTemplateId?: string | null;
    richMenuGroupId?: string | null;
  }>();
  const rank = await updateCardRank(c.env.DB, c.req.param('id'), body);
  if (!rank) return c.json({ success: false, error: 'not_found' }, 404);
  return c.json({ success: true, data: rank });
});

// DELETE /api/card-ranks/:id
cardRanks.delete('/api/card-ranks/:id', async (c) => {
  await deleteCardRank(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});

// POST /api/card-ranks/reorder — { accountId, orderedIds: string[] } (先頭が rank_order=0)
cardRanks.post('/api/card-ranks/reorder', async (c) => {
  const body = await c.req.json<{ accountId: string; orderedIds: string[] }>();
  if (!body.accountId || !Array.isArray(body.orderedIds)) {
    return c.json({ success: false, error: 'accountId, orderedIds required' }, 400);
  }
  await reorderCardRanks(c.env.DB, body.accountId, body.orderedIds);
  const ranks = await getCardRanks(c.env.DB, body.accountId);
  return c.json({ success: true, data: ranks });
});

export { cardRanks };
