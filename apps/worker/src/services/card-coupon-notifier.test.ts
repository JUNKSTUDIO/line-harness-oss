import { describe, expect, test } from 'vitest';
import {
  buildExpiryReminderBubble,
  DEFAULT_RESERVATION_BUTTON_LABEL,
  DEFAULT_RESERVATION_HELPER_TEXT,
  DEFAULT_EXTEND_BUTTON_LABEL,
  type ExpiryReminderContext,
} from './card-coupon-notifier.js';

function findButtonLabels(bubble: unknown): string[] {
  const json = JSON.stringify(bubble);
  const matches = [...json.matchAll(/"label":"([^"]*)"/g)];
  return matches.map((m) => m[1]);
}

function findTexts(bubble: unknown): string[] {
  const json = JSON.stringify(bubble);
  const matches = [...json.matchAll(/"text":"([^"]*)"/g)];
  return matches.map((m) => m[1]);
}

const baseCtx: ExpiryReminderContext = {
  kind: 'card',
  label: '現在のスタンプ数: 5pt',
  expiresAtJst: '2026-07-01',
  reservationUrl: 'https://example.com/reserve',
  extendLiffUrl: 'https://liff.line.me/abc?action=extend',
};

describe('buildExpiryReminderBubble: button label overrides', () => {
  test('uses the default labels when no override is configured', () => {
    const bubble = buildExpiryReminderBubble(baseCtx, 'https://fallback.example');
    expect(findButtonLabels(bubble)).toEqual([DEFAULT_RESERVATION_BUTTON_LABEL, DEFAULT_EXTEND_BUTTON_LABEL]);
    expect(findTexts(bubble)).toContain(DEFAULT_RESERVATION_HELPER_TEXT);
  });

  test('uses the admin-configured labels when set', () => {
    const bubble = buildExpiryReminderBubble(
      {
        ...baseCtx,
        reservationButtonLabel: '席を取る',
        reservationHelperText: 'お早めにご予約ください！',
        extendButtonLabel: '来店できない方はこちら',
      },
      'https://fallback.example',
    );
    expect(findButtonLabels(bubble)).toEqual(['席を取る', '来店できない方はこちら']);
    expect(findTexts(bubble)).toContain('お早めにご予約ください！');
  });

  test('falls back to defaults when overrides are explicitly empty strings', () => {
    const bubble = buildExpiryReminderBubble(
      { ...baseCtx, reservationButtonLabel: '', reservationHelperText: '', extendButtonLabel: '' },
      'https://fallback.example',
    );
    expect(findButtonLabels(bubble)).toEqual([DEFAULT_RESERVATION_BUTTON_LABEL, DEFAULT_EXTEND_BUTTON_LABEL]);
  });
});
