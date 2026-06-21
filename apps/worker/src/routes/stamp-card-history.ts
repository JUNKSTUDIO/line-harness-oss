// お客様ごとのスタンプ付与履歴・クーポン利用履歴 — 管理画面 + スタッフのQRスキャン画面で共用する。

import { Hono } from 'hono';
import { getUserCard, getStampLogsForUserCard, getUserCoupons } from '@line-crm/db';
import type { Env } from '../index.js';

const stampCardHistory = new Hono<Env>();

// GET /api/friends/:friendId/stamp-card-history?accountId=xxx
stampCardHistory.get('/api/friends/:friendId/stamp-card-history', async (c) => {
  const accountId = c.req.query('accountId');
  const friendId = c.req.param('friendId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const card = await getUserCard(c.env.DB, friendId, accountId);
  const [stampLogs, coupons] = await Promise.all([
    card ? getStampLogsForUserCard(c.env.DB, card.id) : Promise.resolve([]),
    getUserCoupons(c.env.DB, friendId),
  ]);

  return c.json({
    success: true,
    data: {
      card: card ? { stampCount: card.stamp_count, totalStampCount: card.total_stamp_count, status: card.status } : null,
      stampLogs,
      coupons: coupons.map((cp) => ({
        id: cp.id,
        name: cp.display_name,
        description: cp.display_description,
        imageUrl: cp.display_image_url,
        status: cp.status,
        issuedAt: cp.issued_at,
        expiresAt: cp.expires_at,
        usedAt: cp.used_at,
      })),
    },
  });
});

export { stampCardHistory };
