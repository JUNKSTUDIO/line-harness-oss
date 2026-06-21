import { describe, expect, test } from 'vitest';
import { sendCouponIssuedNotification } from './card-coupon-notifier.js';

function stubDB(template: { message_type: string; message_content: string } | null) {
  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM templates')) return template;
              return null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return db;
}

const sampleCoupon = { name: 'ブロンズクリア特典', imageUrl: 'https://example.com/coupon.jpg', expiresAtJst: '2026/7/5' };

describe('sendCouponIssuedNotification', () => {
  test('sends the fallback text when no message template is configured', async () => {
    const db = stubDB(null);
    const sent: unknown[] = [];
    await sendCouponIssuedNotification({
      db,
      channelAccessToken: 'tok',
      toLineUserId: 'Uxxxx',
      liffId: 'liff-1',
      messageTemplateId: null,
      fallbackText: '「クーポン」を獲得しました！',
      coupon: sampleCoupon,
      sender: async (_token, _to, message) => { sent.push(message); },
    });
    expect(sent).toEqual([{ type: 'text', text: '「クーポン」を獲得しました！' }]);
  });

  test('sends the configured flex template instead of the fallback text', async () => {
    const flexContents = { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'クーポン獲得' }] } };
    const db = stubDB({ message_type: 'flex', message_content: JSON.stringify(flexContents) });
    const sent: Array<{ type: string; contents?: unknown }> = [];
    await sendCouponIssuedNotification({
      db,
      channelAccessToken: 'tok',
      toLineUserId: 'Uxxxx',
      liffId: 'liff-1',
      messageTemplateId: 'msg-tpl-1',
      fallbackText: 'fallback',
      coupon: sampleCoupon,
      sender: async (_token, _to, message) => { sent.push(message); },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('flex');
    expect(sent[0].contents).toEqual(flexContents);
  });

  test('falls back to the text message when the configured template is missing/deleted', async () => {
    const db = stubDB(null);
    const sent: unknown[] = [];
    await sendCouponIssuedNotification({
      db,
      channelAccessToken: 'tok',
      toLineUserId: 'Uxxxx',
      liffId: null,
      messageTemplateId: 'deleted-template-id',
      fallbackText: 'fallback text',
      coupon: sampleCoupon,
      sender: async (_token, _to, message) => { sent.push(message); },
    });
    expect(sent).toEqual([{ type: 'text', text: 'fallback text' }]);
  });

  test('substitutes {{coupon_name}}, {{coupon_image_url}}, {{coupon_expires_at}} inside a flex template', async () => {
    const flexContents = {
      type: 'bubble',
      hero: { type: 'image', url: '{{coupon_image_url}}', size: 'full', aspectRatio: '20:13', aspectMode: 'cover' },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: 'クーポンを獲得しました！' },
          { type: 'text', text: '{{coupon_name}}' },
          { type: 'text', text: '有効期限: {{coupon_expires_at}}まで' },
        ],
      },
    };
    const db = stubDB({ message_type: 'flex', message_content: JSON.stringify(flexContents) });
    const sent: Array<{ type: string; contents?: { hero: { url: string }; body: { contents: Array<{ text: string }> } } }> = [];
    await sendCouponIssuedNotification({
      db,
      channelAccessToken: 'tok',
      toLineUserId: 'Uxxxx',
      liffId: null,
      messageTemplateId: 'msg-tpl-1',
      fallbackText: 'fallback',
      coupon: sampleCoupon,
      sender: async (_token, _to, message) => { sent.push(message); },
    });
    const contents = sent[0].contents!;
    expect(contents.hero.url).toBe('https://example.com/coupon.jpg');
    expect(contents.body.contents.map((c) => c.text)).toEqual([
      'クーポンを獲得しました！',
      'ブロンズクリア特典',
      '有効期限: 2026/7/5まで',
    ]);
  });

  test('substitutes {{coupon_image_url}} with an empty string when the coupon has no image', async () => {
    const db = stubDB({ message_type: 'flex', message_content: JSON.stringify({ type: 'bubble', hero: { type: 'image', url: '{{coupon_image_url}}' } }) });
    const sent: Array<{ contents?: { hero: { url: string } } }> = [];
    await sendCouponIssuedNotification({
      db,
      channelAccessToken: 'tok',
      toLineUserId: 'Uxxxx',
      liffId: null,
      messageTemplateId: 'msg-tpl-1',
      fallbackText: 'fallback',
      coupon: { ...sampleCoupon, imageUrl: null },
      sender: async (_token, _to, message) => { sent.push(message); },
    });
    expect(sent[0].contents!.hero.url).toBe('');
  });
});
