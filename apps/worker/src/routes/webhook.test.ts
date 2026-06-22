import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  pushMessage: vi.fn(),
}));

// Stub the DB graph — these tests focus on webhook guard behavior and the
// first-contact friend registration path without touching real D1/LINE.
vi.mock('@line-crm/db', () => ({
  upsertFriend: vi.fn(),
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  jstNow: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getFriendById: vi.fn(),
  getCardSettings: vi.fn(),
  getCouponTemplateById: vi.fn(),
  issueCoupon: vi.fn(),
  getLineAccountById: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(),
    LineClient: vi.fn().mockImplementation(() => lineClientMocks),
  };
});

vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn(),
  expandVariables: vi.fn(),
}));

const cardCouponNotifierMocks = vi.hoisted(() => ({
  sendCouponIssuedNotification: vi.fn(),
}));
vi.mock('../services/card-coupon-notifier.js', () => cardCouponNotifierMocks);

import { verifySignature } from '@line-crm/line-sdk';
import {
  addTagToFriend,
  advanceFriendScenario,
  completeFriendScenario,
  computeNextDeliveryAt,
  enrollFriendInScenario,
  getEntryRouteByRefCode,
  getFriendByLineUserId,
  getLineAccounts,
  getMessageTemplateById,
  getScenarioSteps,
  getScenarios,
  jstNow,
  resolveStepContent,
  updateFriendFollowStatus,
  upsertChatOnMessage,
  upsertFriend,
  getCardSettings,
  getCouponTemplateById,
  issueCoupon,
  getLineAccountById,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

const baseEnv = {
  DB: {} as D1Database,
  LINE_CHANNEL_SECRET: 'env-default-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-default-token',
} as Record<string, unknown>;

const baseExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLineAccounts).mockResolvedValue([]);
});

describe('POST /webhook — DoS defenses (#104)', () => {
  test('rejects with 413 when Content-Length declares an oversized body', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024), // 2 MiB > 1 MiB cap
          'X-Line-Signature': 'whatever',
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    // Signature verification must not even be attempted on an oversized body.
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('rejects with 413 when actual body exceeds the cap even if Content-Length is absent', async () => {
    const app = setupApp();
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'whatever',
        },
        body: oversizedBody,
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('verifies signature before parsing JSON — malformed body with invalid signature never reaches the parser', async () => {
    vi.mocked(verifySignature).mockResolvedValue(false);

    const app = setupApp();
    // 44-char signature (valid HMAC-SHA256 base64 length) so it clears the
    // length pre-check and reaches verifySignature. Malformed JSON body: if
    // signature were verified *after* parse (old behavior), we'd hit the
    // parser-failure branch first. With signature-first, we get the invalid-
    // signature branch and never attempt to parse.
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: '{not valid json',
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // verifySignature must run; rejection happens before any parse attempt.
    expect(verifySignature).toHaveBeenCalled();
    expect(verifySignature).toHaveBeenCalledWith('env-default-secret', '{not valid json', validShapedSignature);
  });

  test('rejects unsigned or malformed-signature requests without hitting verifySignature or D1', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-Line-Signature header entirely.
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // Fast-rejected before any crypto / DB work.
    expect(verifySignature).not.toHaveBeenCalled();
  });
});

describe('POST /webhook — first-contact existing friends', () => {
  test('auto-registers an unknown text-message sender without firing friend_add handling', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(jstNow).mockReturnValue('2026-06-18T12:00:00.000+09:00');
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: 'https://example.com/profile.jpg',
      status_message: 'hello',
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });
    vi.mocked(upsertChatOnMessage).mockResolvedValue({
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: null,
      status: 'unread',
      notes: null,
      last_message_at: '2026-06-18T12:00:00.000+09:00',
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'message',
              replyToken: 'reply-token',
              message: { type: 'text', id: 'message-1', text: 'こんにちは' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-1',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    expect(lineClientMocks.getProfile).toHaveBeenCalledWith('U-existing');
    expect(upsertFriend).toHaveBeenCalledWith(db, {
      lineUserId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'message_received',
      expect.objectContaining({ friendId: 'friend-1' }),
      'env-default-token',
      null,
    );
    expect(getScenarios).not.toHaveBeenCalled();
    expect(enrollFriendInScenario).not.toHaveBeenCalled();

    // Keep the unrelated DB stubs quiet but type-checked as mocked imports.
    expect(updateFriendFollowStatus).not.toHaveBeenCalled();
    expect(getScenarioSteps).not.toHaveBeenCalled();
    expect(advanceFriendScenario).not.toHaveBeenCalled();
    expect(completeFriendScenario).not.toHaveBeenCalled();
    expect(computeNextDeliveryAt).not.toHaveBeenCalled();
    expect(resolveStepContent).not.toHaveBeenCalled();
    expect(addTagToFriend).not.toHaveBeenCalled();
    expect(getEntryRouteByRefCode).not.toHaveBeenCalled();
    expect(getMessageTemplateById).not.toHaveBeenCalled();
  });
});

describe('POST /webhook — follow: friend-add coupon issuance', () => {
  const issuedCoupon = {
    id: 'coupon-1',
    coupon_name_at_issuance: '友だち追加特典',
    coupon_image_url_at_issuance: null,
    expires_at: '2026-07-05T00:00:00.000+09:00',
  };

  function setupFollowMocks(opts: { refCode: string | null }) {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([
      {
        id: 'acc-1',
        is_active: 1,
        channel_secret: 'env-default-secret',
        channel_access_token: 'env-default-token',
      },
    ] as unknown as Awaited<ReturnType<typeof getLineAccounts>>);
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-newfriend',
      displayName: 'New Friend',
      pictureUrl: null,
      statusMessage: null,
    });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-newfriend',
      display_name: 'New Friend',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      ref_code: opts.refCode,
      created_at: '2026-06-22T12:00:00.000+09:00',
      updated_at: '2026-06-22T12:00:00.000+09:00',
    } as unknown as Awaited<ReturnType<typeof upsertFriend>>);
    vi.mocked(getScenarios).mockResolvedValue([]);
  }

  function runFollowEvent(db: D1Database) {
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    return app
      .request(
        '/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Line-Signature': validShapedSignature },
          body: JSON.stringify({
            destination: 'bot',
            events: [
              {
                type: 'follow',
                replyToken: 'reply-token',
                timestamp: Date.now(),
                source: { type: 'user', userId: 'U-newfriend' },
                webhookEventId: 'event-1',
                deliveryContext: { isRedelivery: false },
                mode: 'active',
              },
            ],
          }),
        },
        { ...baseEnv, DB: db },
        executionCtx,
      )
      .then(async (res) => {
        const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
        await processing;
        return res;
      });
  }

  function makeDbStub(): D1Database {
    const stmt = { bind: vi.fn(), run: vi.fn().mockResolvedValue({}), all: vi.fn().mockResolvedValue({ results: [] }) };
    stmt.bind.mockReturnValue(stmt);
    return { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;
  }

  test('issues the referral-link-specific coupon when the route has one configured', async () => {
    setupFollowMocks({ refCode: 'youtube' });
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue({
      id: 'route-1', ref_code: 'youtube', name: 'YouTube', tag_id: null, scenario_id: null,
      intro_template_id: null, run_account_friend_add_scenarios: 1, coupon_template_id: 'tpl-route', is_active: 1,
      created_at: '', updated_at: '',
    } as unknown as EntryRoute);
    vi.mocked(getCouponTemplateById).mockResolvedValue({ id: 'tpl-route', is_active: 1, message_template_id: null } as never);
    vi.mocked(issueCoupon).mockResolvedValue(issuedCoupon as never);
    vi.mocked(getLineAccountById).mockResolvedValue({ liff_id: 'liff-1' } as never);

    const db = makeDbStub();
    const res = await runFollowEvent(db);

    expect(res.status).toBe(200);
    expect(issueCoupon).toHaveBeenCalledWith(db, expect.objectContaining({
      friendId: 'friend-1', lineAccountId: 'acc-1', couponTemplateId: 'tpl-route', issuedVia: 'campaign',
    }));
    expect(cardCouponNotifierMocks.sendCouponIssuedNotification).toHaveBeenCalledWith(expect.objectContaining({
      channelAccessToken: 'env-default-token', toLineUserId: 'U-newfriend', liffId: 'liff-1',
    }));
    expect(getCardSettings).not.toHaveBeenCalled();
  });

  test('falls back to the account default coupon when there is no referral route', async () => {
    setupFollowMocks({ refCode: null });
    vi.mocked(getCardSettings).mockResolvedValue({ friend_add_coupon_template_id: 'tpl-default' } as never);
    vi.mocked(getCouponTemplateById).mockResolvedValue({ id: 'tpl-default', is_active: 1, message_template_id: 'msg-1' } as never);
    vi.mocked(issueCoupon).mockResolvedValue(issuedCoupon as never);
    vi.mocked(getLineAccountById).mockResolvedValue({ liff_id: 'liff-1' } as never);

    const db = makeDbStub();
    const res = await runFollowEvent(db);

    expect(res.status).toBe(200);
    expect(getEntryRouteByRefCode).not.toHaveBeenCalled();
    expect(issueCoupon).toHaveBeenCalledWith(db, expect.objectContaining({ couponTemplateId: 'tpl-default' }));
    expect(cardCouponNotifierMocks.sendCouponIssuedNotification).toHaveBeenCalledWith(expect.objectContaining({ messageTemplateId: 'msg-1' }));
  });

  test('issues nothing when neither the route nor the account has a coupon configured', async () => {
    setupFollowMocks({ refCode: null });
    vi.mocked(getCardSettings).mockResolvedValue({ friend_add_coupon_template_id: null } as never);

    const db = makeDbStub();
    const res = await runFollowEvent(db);

    expect(res.status).toBe(200);
    expect(issueCoupon).not.toHaveBeenCalled();
    expect(cardCouponNotifierMocks.sendCouponIssuedNotification).not.toHaveBeenCalled();
  });

  test('prefers the referral-link coupon and does not also issue the account default (no double issuance)', async () => {
    setupFollowMocks({ refCode: 'youtube' });
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue({
      id: 'route-1', ref_code: 'youtube', name: 'YouTube', tag_id: null, scenario_id: null,
      intro_template_id: null, run_account_friend_add_scenarios: 1, coupon_template_id: 'tpl-route', is_active: 1,
      created_at: '', updated_at: '',
    } as unknown as EntryRoute);
    vi.mocked(getCouponTemplateById).mockResolvedValue({ id: 'tpl-route', is_active: 1, message_template_id: null } as never);
    vi.mocked(issueCoupon).mockResolvedValue(issuedCoupon as never);
    vi.mocked(getLineAccountById).mockResolvedValue({ liff_id: 'liff-1' } as never);

    const db = makeDbStub();
    await runFollowEvent(db);

    expect(issueCoupon).toHaveBeenCalledTimes(1);
    expect(getCardSettings).not.toHaveBeenCalled();
  });
});
