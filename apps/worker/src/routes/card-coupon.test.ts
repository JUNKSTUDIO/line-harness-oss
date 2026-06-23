import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const dbMocks = vi.hoisted(() => ({
  getOrCreateUserCard: vi.fn(),
  getCardRanks: vi.fn(),
  getCardSettings: vi.fn(),
  getUserCoupons: vi.fn(),
  extendUserCardExpiry: vi.fn(),
  extendUserCouponExpiry: vi.fn(),
  getUserCardById: vi.fn(),
  getUserCouponById: vi.fn(),
  getLineAccountById: vi.fn(),
  getCardRankMilestones: vi.fn(),
  getIssuedMilestoneIds: vi.fn(),
  getCouponTemplateById: vi.fn(),
  setFriendBirthday: vi.fn(),
}));
vi.mock('@line-crm/db', () => dbMocks);

const liffAuthMocks = vi.hoisted(() => ({ verifyCallerLineUserId: vi.fn() }));
vi.mock('../services/liff-auth.js', () => liffAuthMocks);

vi.mock('../services/card-coupon-notifier.js', () => ({
  sendExtensionConfirmed: vi.fn(),
  sendExtensionAlreadyUsed: vi.fn(),
}));

const fetchIcalEventsMock = vi.hoisted(() => vi.fn());
vi.mock('../services/business-calendar.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/business-calendar.js')>();
  return { ...actual, fetchIcalEvents: fetchIcalEventsMock };
});

const { cardCoupon } = await import('./card-coupon.js');

type TestEnv = { Bindings: { DB: D1Database } };

function makeDb(opts: { accountRow: unknown; friendRow: unknown }): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          first: async () => {
            if (sql.includes('FROM line_accounts')) return opts.accountRow;
            if (sql.includes('FROM friends')) return opts.friendRow;
            return null;
          },
        }),
      };
    },
  } as unknown as D1Database;
}

function setupApp(db: D1Database) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    await next();
  });
  app.route('/', cardCoupon);
  return app;
}

const accountRow = { id: 'acc-1' };
const friendRow = { id: 'friend-1', line_account_id: 'acc-1', birthday_year: null, birthday_month: null, birthday_day: null };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  liffAuthMocks.verifyCallerLineUserId.mockReset();
  fetchIcalEventsMock.mockReset();
  liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('Uxxxx');
  dbMocks.getUserCoupons.mockResolvedValue([]);
  dbMocks.getOrCreateUserCard.mockResolvedValue({ expires_at: null });
});

describe('GET /api/liff/calendar', () => {
  test('returns 401 when the LIFF idToken cannot be verified', async () => {
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue(null);
    const app = setupApp(makeDb({ accountRow, friendRow }));
    const res = await app.request('/api/liff/calendar?liffId=liff-1');
    expect(res.status).toBe(401);
  });

  test('returns ical events for the current month when calendar_ical_url is configured', async () => {
    dbMocks.getCardSettings.mockResolvedValue({
      calendar_ical_url: 'https://example.com/cal.ics',
      calendar_months_ahead: 3,
      calendar_show_coupon_expiry: 0,
      calendar_show_card_expiry: 0,
    });
    fetchIcalEventsMock.mockResolvedValue([{ date: '2026-07-05', title: '臨時休業' }]);

    const app = setupApp(makeDb({ accountRow, friendRow }));
    const res = await app.request('/api/liff/calendar?liffId=liff-1&month=2026-07');
    const json = await res.json() as { month: string; events: unknown[] };

    expect(res.status).toBe(200);
    expect(json.month).toBe('2026-07');
    expect(json.events).toEqual([{ date: '2026-07-05', title: '臨時休業' }]);
    expect(fetchIcalEventsMock).toHaveBeenCalledWith('https://example.com/cal.ics', expect.any(Date), expect.any(Date));
  });

  test('does not fetch ical events when calendar_ical_url is not configured', async () => {
    dbMocks.getCardSettings.mockResolvedValue({
      calendar_ical_url: null,
      calendar_months_ahead: 3,
      calendar_show_coupon_expiry: 0,
      calendar_show_card_expiry: 0,
    });

    const app = setupApp(makeDb({ accountRow, friendRow }));
    const res = await app.request('/api/liff/calendar?liffId=liff-1');
    const json = await res.json() as { events: unknown[] };

    expect(fetchIcalEventsMock).not.toHaveBeenCalled();
    expect(json.events).toEqual([]);
  });

  test('includes coupon expiries within the requested month only when the toggle is on', async () => {
    dbMocks.getCardSettings.mockResolvedValue({
      calendar_ical_url: null,
      calendar_months_ahead: 3,
      calendar_show_coupon_expiry: 1,
      calendar_show_card_expiry: 0,
    });
    dbMocks.getUserCoupons.mockResolvedValue([
      { id: 'coupon-1', display_name: '無料クーポン', display_image_url: 'https://example.com/c1.png', expires_at: '2026-07-05T03:00:00.000Z' }, // JST 7/5 12:00
      { id: 'coupon-2', display_name: '8月のクーポン', display_image_url: null, expires_at: '2026-08-01T00:00:00.000Z' }, // JST 8/1 09:00 → 別月
    ]);

    const app = setupApp(makeDb({ accountRow, friendRow }));
    const res = await app.request('/api/liff/calendar?liffId=liff-1&month=2026-07');
    const json = await res.json() as { couponExpiries: Array<{ date: string; coupons: Array<{ id: string; name: string; imageUrl: string | null }> }> };

    expect(json.couponExpiries).toEqual([
      { date: '2026-07-05', coupons: [{ id: 'coupon-1', name: '無料クーポン', imageUrl: 'https://example.com/c1.png' }] },
    ]);
  });

  test('omits coupon expiries entirely when the toggle is off, even with expiring coupons', async () => {
    dbMocks.getCardSettings.mockResolvedValue({
      calendar_ical_url: null, calendar_months_ahead: 3, calendar_show_coupon_expiry: 0, calendar_show_card_expiry: 0,
    });
    const app = setupApp(makeDb({ accountRow, friendRow }));
    const res = await app.request('/api/liff/calendar?liffId=liff-1&month=2026-07');
    const json = await res.json() as { couponExpiries: unknown[] };

    expect(dbMocks.getUserCoupons).not.toHaveBeenCalled();
    expect(json.couponExpiries).toEqual([]);
  });

  test('includes the card expiry date only when the toggle is on and it falls within the month', async () => {
    dbMocks.getCardSettings.mockResolvedValue({
      calendar_ical_url: null, calendar_months_ahead: 3, calendar_show_coupon_expiry: 0, calendar_show_card_expiry: 1,
    });
    dbMocks.getOrCreateUserCard.mockResolvedValue({ expires_at: '2026-07-20T03:00:00.000Z' }); // JST 7/20

    const app = setupApp(makeDb({ accountRow, friendRow }));
    const res = await app.request('/api/liff/calendar?liffId=liff-1&month=2026-07');
    const json = await res.json() as { cardExpiryDate: string | null };

    expect(json.cardExpiryDate).toBe('2026-07-20');
  });

  test('clamps an out-of-range month request back to the current month', async () => {
    dbMocks.getCardSettings.mockResolvedValue({
      calendar_ical_url: null, calendar_months_ahead: 2, calendar_show_coupon_expiry: 0, calendar_show_card_expiry: 0,
    });
    const app = setupApp(makeDb({ accountRow, friendRow }));
    // 2099-01 は monthsAhead=2 の範囲を大きく超えるので、現在月にフォールバックする
    const res = await app.request('/api/liff/calendar?liffId=liff-1&month=2099-01');
    const json = await res.json() as { month: string };
    const expectedCurrentMonth = (() => {
      const jstNow = new Date(Date.now() + 9 * 3600_000);
      return `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}`;
    })();
    expect(json.month).toBe(expectedCurrentMonth);
  });
});
