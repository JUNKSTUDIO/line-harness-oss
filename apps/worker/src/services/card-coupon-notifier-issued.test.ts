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
      sender: async (_token, _to, message) => { sent.push(message); },
    });
    expect(sent).toEqual([{ type: 'text', text: 'fallback text' }]);
  });
});
