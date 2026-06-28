// スタンプカード/クーポンの期限前リマインド + セルフ延長確認メッセージ送信。
// booking-notifier.ts と同じ「pure render + sender」分割パターン。

import { LineClient, flexBubble, flexBox, flexText, flexButton, flexMessage } from '@line-crm/line-sdk';
import type { FlexBubble, Message } from '@line-crm/line-sdk';
import { getLineAccountById, getTemplateById } from '@line-crm/db';
import { buildMessage } from './broadcast.js';
import { renderMessageContent } from './render-message.js';

export type ExpiryReminderKind = 'card' | 'coupon';

export const DEFAULT_RESERVATION_BUTTON_LABEL = '予約する';
export const DEFAULT_RESERVATION_HELPER_TEXT = 'お席の確保はこちらからどうぞ。';
export const DEFAULT_EXTEND_BUTTON_LABEL = 'どうしても来店できない方はこちら（1回限定で1週間延長）';

export interface ExpiryReminderContext {
  kind: ExpiryReminderKind;
  /** カード: 現在のランク名や進捗。クーポン: クーポン名。 */
  label: string;
  expiresAtJst: string; // "2026-06-27"
  reservationUrl: string | null;
  /** LIFF 延長ボタンの遷移先 (liff.line.me/<liffId>?page=stamp-card&action=extend&...) */
  extendLiffUrl: string;
  /** 管理画面で編集可能なボタン文言・補足テキスト。未設定 (null/undefined) ならデフォルト文言を使う。 */
  reservationButtonLabel?: string | null;
  reservationHelperText?: string | null;
  extendButtonLabel?: string | null;
}

/** 予約ボタンに使う最終URL。reservationUrl未設定ならLIFFのスタンプカード画面(予約セクション)へ。 */
function resolveReservationUrl(ctx: ExpiryReminderContext, fallbackLiffUrl: string): string {
  return ctx.reservationUrl || fallbackLiffUrl;
}

export function buildExpiryReminderBubble(ctx: ExpiryReminderContext, fallbackLiffUrl: string): FlexBubble {
  const title = ctx.kind === 'card' ? 'スタンプカードの有効期限が近づいています' : 'クーポンの有効期限が近づいています';
  const reservationUrl = resolveReservationUrl(ctx, fallbackLiffUrl);
  const reservationButtonLabel = ctx.reservationButtonLabel || DEFAULT_RESERVATION_BUTTON_LABEL;
  const reservationHelperText = ctx.reservationHelperText || DEFAULT_RESERVATION_HELPER_TEXT;
  const extendButtonLabel = ctx.extendButtonLabel || DEFAULT_EXTEND_BUTTON_LABEL;

  return flexBubble({
    header: flexBox(
      'vertical',
      [flexText('⏰ 期限間近のお知らせ', { size: 'sm', weight: 'bold', color: '#c2410c' })],
      { paddingAll: '20px', backgroundColor: '#fff7ed' },
    ),
    body: flexBox(
      'vertical',
      [
        flexText(title, { size: 'md', weight: 'bold', color: '#1e293b', wrap: true }),
        flexText(ctx.label, { size: 'sm', color: '#475569', wrap: true }),
        { type: 'separator', margin: 'md' },
        flexBox(
          'horizontal',
          [
            flexText('有効期限', { size: 'xs', color: '#94a3b8', flex: 2 }),
            flexText(ctx.expiresAtJst, { size: 'xs', color: '#1e293b', weight: 'bold', flex: 3, align: 'end' }),
          ],
          { margin: 'md' },
        ),
        flexText(reservationHelperText, { size: 'xs', color: '#64748b', wrap: true, margin: 'md' }),
      ],
      { paddingAll: '20px', spacing: 'md' },
    ),
    footer: flexBox(
      'vertical',
      [
        flexButton({ type: 'uri', label: reservationButtonLabel, uri: reservationUrl }, { style: 'primary', color: '#06C755' }),
        flexButton(
          { type: 'uri', label: extendButtonLabel, uri: ctx.extendLiffUrl },
          { style: 'secondary' },
        ),
      ],
      { spacing: 'sm', paddingAll: '16px' },
    ),
  });
}

export interface SendExpiryReminderParams {
  channelAccessToken: string;
  toLineUserId: string;
  ctx: ExpiryReminderContext;
  fallbackLiffUrl: string;
}

export async function sendExpiryReminder(params: SendExpiryReminderParams): Promise<void> {
  const client = new LineClient(params.channelAccessToken);
  const bubble = buildExpiryReminderBubble(params.ctx, params.fallbackLiffUrl);
  const altText = params.ctx.kind === 'card' ? '【期限間近】スタンプカードの有効期限が近づいています' : '【期限間近】クーポンの有効期限が近づいています';
  await client.pushMessage(params.toLineUserId, [flexMessage(altText, bubble)]);
}

export async function sendExtensionConfirmed(channelAccessToken: string, toLineUserId: string): Promise<void> {
  const client = new LineClient(channelAccessToken);
  await client.pushTextMessage(toLineUserId, '有効期限を1週間延長しました。ご来店を心よりお待ちしております！');
}

export async function sendExtensionAlreadyUsed(channelAccessToken: string, toLineUserId: string): Promise<void> {
  const client = new LineClient(channelAccessToken);
  await client.pushTextMessage(toLineUserId, 'このカード/クーポンは既に一度延長されています。延長は1回限定でご利用いただけます。');
}

/** アカウントのLIFF IDから延長ボタン用URLを組み立てる。liff_id未設定ならWorker直URL(?liffId=不要)にフォールバック。 */
export async function resolveExtendLiffUrl(
  db: D1Database,
  lineAccountId: string,
  envLiffUrl: string,
  query: { kind: ExpiryReminderKind; id: string },
): Promise<string> {
  const account = await getLineAccountById(db, lineAccountId);
  const params = new URLSearchParams({ page: 'stamp-card', action: 'extend', kind: query.kind, id: query.id });
  if (account?.liff_id) {
    return `https://liff.line.me/${account.liff_id}?${params.toString()}`;
  }
  return envLiffUrl ? `${envLiffUrl}?${params.toString()}` : '#';
}

export type CouponIssuedSender = (channelAccessToken: string, toLineUserId: string, messages: Message[]) => Promise<unknown>;

/**
 * クーポン配布メッセージの末尾に添える「クーポンを使う」ボタン。
 * タップするとスタンプカードLIFFのQR画面 (action=qr) が開き、
 * 店舗スタッフがレジで読み取る本人確認QR (grant token) が表示される。
 * liffId が無いアカウントではQR画面へ遷移できないため null を返してボタンを省く。
 */
export function buildCouponUseButtonMessage(liffId: string | null): Message | null {
  if (!liffId) return null;
  const qrUrl = `https://liff.line.me/${liffId}?page=stamp-card&action=qr`;
  const bubble = flexBubble({
    body: flexBox(
      'vertical',
      [flexText('ご利用の際は下のボタンからQRコードをスタッフにお見せください。', { size: 'xs', color: '#64748b', wrap: true, align: 'center' })],
      { paddingAll: '16px' },
    ),
    footer: flexBox(
      'vertical',
      [flexButton({ type: 'uri', label: 'クーポンを使う', uri: qrUrl }, { style: 'primary', color: '#06C755' })],
      { paddingAll: '16px', paddingTop: '0px' },
    ),
  });
  return flexMessage('クーポンを使う', bubble);
}

/**
 * 管理画面でリッチメッセージを作る際に使える、クーポン発行時だけの差し込みプレースホルダー。
 * 例: hero画像のurlに {{coupon_image_url}}、本文に {{coupon_name}}・{{coupon_expires_at}} を書いておくと、
 * 実際に発行されたクーポンの内容に応じて自動で差し替わる。
 */
function renderCouponPlaceholders(content: string, coupon: { name: string; imageUrl: string | null; expiresAtJst: string }): string {
  return content
    .replaceAll('{{coupon_name}}', coupon.name)
    .replaceAll('{{coupon_image_url}}', coupon.imageUrl ?? '')
    .replaceAll('{{coupon_expires_at}}', coupon.expiresAtJst);
}

/**
 * クーポン発行 (ランク到達/中間マイルストーン/誕生月) の通知。
 * coupon_templates.message_template_id が設定されていれば、管理画面の「テンプレート」で
 * 事前に作成した Flex/テキストメッセージをそのまま送る (要件: リッチメッセージを先に作って配信したい)。
 * 未設定なら呼び出し側が用意した文言にフォールバックする。
 */
export async function sendCouponIssuedNotification(params: {
  db: D1Database;
  channelAccessToken: string;
  toLineUserId: string;
  liffId: string | null;
  messageTemplateId: string | null;
  fallbackText: string;
  coupon: { name: string; imageUrl: string | null; expiresAtJst: string };
  sender?: CouponIssuedSender;
}): Promise<void> {
  const sender = params.sender ?? ((token, to, messages) => new LineClient(token).pushMessage(to, messages));

  let message: Message = { type: 'text', text: params.fallbackText };
  if (params.messageTemplateId) {
    const template = await getTemplateById(params.db, params.messageTemplateId);
    if (template) {
      const renderedContent = renderCouponPlaceholders(renderMessageContent(template.message_content, params.liffId), params.coupon);
      message = buildMessage(template.message_type, renderedContent);
    }
  }
  // クーポン本体メッセージ (テキスト/Flex問わず) の下に「クーポンを使う」ボタンを1つの吹き出しとして添える。
  const useButton = buildCouponUseButtonMessage(params.liffId);
  const messages = useButton ? [message, useButton] : [message];
  await sender(params.channelAccessToken, params.toLineUserId, messages);
}
