import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getUserCard: vi.fn(),
  getStampLogsForUserCard: vi.fn(),
  getUserCoupons: vi.fn(),
  getCardSettings: vi.fn(),
  grantStamp: vi.fn(),
  issueCoupon: vi.fn(),
  getCouponTemplateById: vi.fn(),
  getLineAccountById: vi.fn(),
  getFriendById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const sideEffectsMock = vi.fn();
vi.mock('../services/grant-stamp-side-effects.js', () => ({ processGrantStampSideEffects: sideEffectsMock }));

const sendNotificationMock = vi.fn();
vi.mock('../services/card-coupon-notifier.js', () => ({ sendCouponIssuedNotification: sendNotificationMock }));

const { stampCardHistory } = await import('./stamp-card-history.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } | undefined };
  Bindings: { DB: D1Database };
};

function setupApp(role: 'owner' | 'admin' | 'staff' | undefined = 'owner', staffId = 'staff-1') {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    if (role) c.set('staff', { id: staffId, role });
    c.env = { DB: {} as D1Database };
    await next();
  });
  app.route('/', stampCardHistory);
  return app;
}

const fakeFriend = { id: 'friend-1', line_account_id: 'acc-1', line_user_id: 'Uxxxx', display_name: 'テスト' };
const fakeAccount = { id: 'acc-1', channel_access_token: 'token', liff_id: 'liff-1' };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  sideEffectsMock.mockReset();
  sendNotificationMock.mockReset();
});

describe('POST /api/friends/:friendId/stamp-card/grant-points', () => {
  test('rejects with 403 when the staff role is below the configured threshold', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'owner' });
    const app = setupApp('admin');
    const res = await app.request('/api/friends/friend-1/stamp-card/grant-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', points: 5 }),
    });
    expect(res.status).toBe(403);
    expect(dbMocks.grantStamp).not.toHaveBeenCalled();
  });

  test('rejects with 400 on a non-0.5-step or non-positive points value', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'staff' });
    const app = setupApp('owner');
    const res = await app.request('/api/friends/friend-1/stamp-card/grant-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', points: 1.3 }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.grantStamp).not.toHaveBeenCalled();
  });

  test('grants exactly the requested points with skipMultiplier, when role meets the threshold', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'admin' });
    dbMocks.getFriendById.mockResolvedValue(fakeFriend);
    const grantResult = { card: { stamp_count: 5 }, finalPoints: 5, rankedUp: false, issuedCoupon: null, milestonesCrossed: [] };
    dbMocks.grantStamp.mockResolvedValue(grantResult);
    sideEffectsMock.mockResolvedValue({ milestoneCouponNames: [] });

    const app = setupApp('admin');
    const res = await app.request('/api/friends/friend-1/stamp-card/grant-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', points: 5 }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.grantStamp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ friendId: 'friend-1', lineAccountId: 'acc-1', source: 'manual', manualBasePoints: 5, skipMultiplier: true, grantedByStaffId: 'staff-1' }),
    );
    expect(sideEffectsMock).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'friend-1', grantResult);
  });

  test('rejects with 404 when the friend does not belong to the given account', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'staff' });
    dbMocks.getFriendById.mockResolvedValue({ ...fakeFriend, line_account_id: 'other-acc' });
    const app = setupApp('owner');
    const res = await app.request('/api/friends/friend-1/stamp-card/grant-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', points: 5 }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.grantStamp).not.toHaveBeenCalled();
  });

  // 'env-owner' は環境変数API_KEYでの認証時に使われる疑似ID で、staffテーブルに実体がない。
  // そのままgrantedByStaffIdに渡すとFK制約違反になるため、undefinedに変換される必要がある
  // (実際にサンドボックスで再現したリグレッション)。
  test('omits grantedByStaffId when authenticated via the env API_KEY sentinel id', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'owner' });
    dbMocks.getFriendById.mockResolvedValue(fakeFriend);
    const grantResult = { card: { stamp_count: 5 }, finalPoints: 5, rankedUp: false, issuedCoupon: null, milestonesCrossed: [] };
    dbMocks.grantStamp.mockResolvedValue(grantResult);
    sideEffectsMock.mockResolvedValue({ milestoneCouponNames: [] });

    const app = setupApp('owner', 'env-owner');
    const res = await app.request('/api/friends/friend-1/stamp-card/grant-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', points: 5 }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.grantStamp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grantedByStaffId: undefined }),
    );
  });
});

describe('POST /api/friends/:friendId/stamp-card/issue-coupon', () => {
  test('rejects with 403 when the staff role is below the configured threshold', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'owner' });
    const app = setupApp('staff');
    const res = await app.request('/api/friends/friend-1/stamp-card/issue-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', couponTemplateId: 'tpl-1' }),
    });
    expect(res.status).toBe(403);
    expect(dbMocks.issueCoupon).not.toHaveBeenCalled();
  });

  test('rejects with 404 when the coupon template belongs to a different account', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'staff' });
    dbMocks.getFriendById.mockResolvedValue(fakeFriend);
    dbMocks.getCouponTemplateById.mockResolvedValue({ id: 'tpl-1', line_account_id: 'other-acc', is_active: 1 });
    const app = setupApp('owner');
    const res = await app.request('/api/friends/friend-1/stamp-card/issue-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', couponTemplateId: 'tpl-1' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.issueCoupon).not.toHaveBeenCalled();
  });

  test('rejects with 404 when the coupon template is inactive', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'staff' });
    dbMocks.getFriendById.mockResolvedValue(fakeFriend);
    dbMocks.getCouponTemplateById.mockResolvedValue({ id: 'tpl-1', line_account_id: 'acc-1', is_active: 0 });
    const app = setupApp('owner');
    const res = await app.request('/api/friends/friend-1/stamp-card/issue-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', couponTemplateId: 'tpl-1' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.issueCoupon).not.toHaveBeenCalled();
  });

  test('issues the coupon and sends the notification, when role meets the threshold', async () => {
    dbMocks.getCardSettings.mockResolvedValue({ remote_grant_min_role: 'admin' });
    dbMocks.getFriendById.mockResolvedValue(fakeFriend);
    dbMocks.getCouponTemplateById.mockResolvedValue({ id: 'tpl-1', line_account_id: 'acc-1', is_active: 1, message_template_id: 'msg-1' });
    const issuedCoupon = {
      id: 'coupon-1', coupon_name_at_issuance: 'ブロンズ特典', coupon_image_url_at_issuance: null,
      expires_at: '2026-07-05T00:00:00.000+09:00',
    };
    dbMocks.issueCoupon.mockResolvedValue(issuedCoupon);
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);

    const app = setupApp('admin');
    const res = await app.request('/api/friends/friend-1/stamp-card/issue-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', couponTemplateId: 'tpl-1' }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.issueCoupon).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ friendId: 'friend-1', lineAccountId: 'acc-1', couponTemplateId: 'tpl-1', issuedVia: 'manual' }),
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      channelAccessToken: 'token',
      toLineUserId: 'Uxxxx',
      messageTemplateId: 'msg-1',
    }));
  });
});
