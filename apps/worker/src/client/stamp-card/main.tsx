// main.tsx — Stamp card LIFF entry. Loaded via dynamic import from
// apps/worker/src/client/main.ts (?page=stamp-card, or ?page=stamp-card&action=extend
// &kind=card|coupon&id=<id> from the expiry-reminder push message button).
// UI/UX rationale: docs/stamp-card-coupon-liff-ux.md
// Mirrors event-booking design language (LINE 緑 + sc-card + fade animations).

import { StrictMode, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './styles.css';

let _root: Root | null = null;

export interface StampCardContext {
  liffId: string;
  lineUserId: string;
  idToken: string;
}

interface CardView {
  id: string;
  stampCount: number;
  totalStampCount: number;
  goal: number | null;
  remainingToGoal: number | null;
  rankEnabled: boolean;
  currentRankName: string | null;
  nextRankName: string | null;
  expiresAt: string | null;
  expirationExtended: boolean;
  canExtend: boolean;
  status: 'active' | 'expired';
}

interface CardResponse {
  card: CardView;
  reservationUrl: string | null;
  stampImageUrl: string | null;
}

interface CouponItem {
  id: string;
  status: 'unused' | 'used' | 'expired';
  expiresAt: string;
  expirationExtended: boolean;
  canExtend: boolean;
}

function buildAuthHeaders(ctx: StampCardContext, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${ctx.idToken}`, ...extra };
}

function apiGet<T>(path: string, ctx: StampCardContext): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  return fetch(url.toString(), { headers: buildAuthHeaders(ctx) }).then(async (r) => {
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json() as Promise<T>;
  });
}

async function apiPost<T>(path: string, ctx: StampCardContext): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(body.error ?? `API ${res.status}`) as Error & { code?: string };
    err.code = body.error;
    throw err;
  }
  return body;
}

function formatJpDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

// 簡易ヒューリスティック: ランク名の文字列からパレットを決定論的に選ぶ。
// 本実装ではcard_ranksに管理者が色を設定できる列を足す方が望ましい (要件の
// 「背景色やデザインがランクごとに変わる」を厳密に満たすなら admin UI が必要)。
const RANK_PALETTES = [
  { from: '#fef3c7', to: '#fde68a', label: '#92400e' }, // bronze-ish
  { from: '#f1f5f9', to: '#cbd5e1', label: '#475569' }, // silver-ish
  { from: '#fef9c3', to: '#facc15', label: '#854d0e' }, // gold-ish
  { from: '#e0e7ff', to: '#a5b4fc', label: '#3730a3' }, // platinum-ish
];

function paletteFor(rankName: string | null) {
  if (!rankName) return RANK_PALETTES[0];
  let hash = 0;
  for (const ch of rankName) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return RANK_PALETTES[hash % RANK_PALETTES.length];
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="sc-spinner" />
    </div>
  );
}

function RankBadge({ card }: { card: CardView }) {
  if (!card.rankEnabled) return null;
  const palette = paletteFor(card.currentRankName);
  return (
    <div
      className="sc-card text-center"
      style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
    >
      <div className="text-xs" style={{ color: palette.label }}>現在のランク</div>
      <div className="text-lg font-bold mt-1" style={{ color: palette.label }}>
        {card.currentRankName ?? '-'}
      </div>
      <div className="text-xs mt-2" style={{ color: palette.label }}>
        {card.nextRankName ? `次のランク: ${card.nextRankName}` : '最高ランクです🎉'}
      </div>
    </div>
  );
}

// 紙のショップカードを模した「マス目にスタンプがポンと押される」見た目。
// goal が無い (フリー集計) 店舗ではマス目を描けないので数字表示にフォールバックする。
function StampGrid({ card, stampImageUrl }: { card: CardView; stampImageUrl: string | null }) {
  const goal = card.goal;

  return (
    <div className="sc-card mt-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-gray-500">スタンプ</span>
        <span className="text-lg font-bold text-gray-900">
          {card.stampCount}
          {goal != null && <span className="text-sm text-gray-400"> / {goal}</span>}
        </span>
      </div>

      {goal != null ? (
        <div className="sc-stamp-grid mt-3">
          {Array.from({ length: goal }, (_, i) => {
            const filled = i < card.stampCount;
            return (
              <div
                key={i}
                className={`sc-stamp-slot ${filled ? 'sc-stamp-slot-filled' : ''}`}
                style={filled ? { animationDelay: `${i * 60}ms` } : undefined}
              >
                {filled && (stampImageUrl ? (
                  <img src={stampImageUrl} alt="" className="sc-stamp-image" />
                ) : (
                  <span className="sc-stamp-mark">済</span>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-2xl font-bold text-gray-900 mt-2">{card.stampCount}pt</div>
      )}

      <div className="text-xs text-gray-500 mt-3">
        {card.remainingToGoal != null && card.remainingToGoal > 0
          ? `あと${card.remainingToGoal}個でクリア${card.nextRankName ? '（次のランクへ）' : ''}`
          : 'クーポンと交換できます🎁'}
      </div>
    </div>
  );
}

function ExtendSection({
  ctx,
  card,
  onExtended,
}: {
  ctx: StampCardContext;
  card: CardView;
  onExtended: (newExpiresAt: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!card.canExtend || !card.expiresAt) return null;

  async function extend() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ success: boolean; newExpiresAt: string }>(`/api/liff/cards/${card.id}/extend`, ctx);
      onExtended(res.newExpiresAt);
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'already_extended' ? 'このカードは既に一度延長されています' : 'エラーが発生しました。少し時間を置いて再度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sc-extend-card mt-3">
      <div className="text-xs text-orange-700">
        有効期限: {formatJpDate(card.expiresAt)} まで
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <button onClick={extend} disabled={busy} className="sc-secondary-btn mt-2">
        {busy ? '処理中...' : 'どうしても来店できない方はこちら（1回限定で1週間延長）'}
      </button>
    </div>
  );
}

function ExtendedNotice({ newExpiresAt }: { newExpiresAt: string }) {
  return (
    <div className="sc-extend-card mt-3 sc-extend-done">
      <div className="text-sm font-bold text-emerald-700">延長済み</div>
      <div className="text-xs text-emerald-700 mt-1">次の期限: {formatJpDate(newExpiresAt)}</div>
    </div>
  );
}

function CardScreen({ ctx, onShowCoupons }: { ctx: StampCardContext; onShowCoupons: () => void }) {
  const [data, setData] = useState<CardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extendedAt, setExtendedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<CardResponse>('/api/liff/cards/me', ctx)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [ctx]);

  if (error) return <div className="px-4 py-6"><div className="sc-card text-center text-sm text-gray-600">{error}</div></div>;
  if (!data) return <Spinner />;

  const { card, reservationUrl, stampImageUrl } = data;

  return (
    <div className="px-4 py-4 pb-10 sc-fade-in">
      <RankBadge card={card} />
      <StampGrid card={card} stampImageUrl={stampImageUrl} />
      {extendedAt ? <ExtendedNotice newExpiresAt={extendedAt} /> : <ExtendSection ctx={ctx} card={card} onExtended={setExtendedAt} />}
      {reservationUrl && (
        <a href={reservationUrl} className="sc-primary-btn mt-3 block text-center">
          予約する
        </a>
      )}
      <div className="text-center mt-5">
        <button onClick={onShowCoupons} className="text-sm sc-line-green-text underline">
          保有しているクーポンを見る
        </button>
      </div>
    </div>
  );
}

const COUPON_STATUS_LABEL: Record<CouponItem['status'], string> = {
  unused: '未使用', used: '使用済み', expired: '期限切れ',
};

function CouponListScreen({ ctx, onBack }: { ctx: StampCardContext; onBack: () => void }) {
  const [items, setItems] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ items: CouponItem[] }>('/api/liff/coupons/me', ctx)
      .then((r) => setItems(r.items))
      .finally(() => setLoading(false));
  }, [ctx]);

  return (
    <div className="px-4 py-4 pb-10 sc-fade-in">
      <button onClick={onBack} className="sc-back-btn">← 戻る</button>
      {loading ? <Spinner /> : items.length === 0 ? (
        <div className="sc-card text-center text-sm text-gray-500 mt-3">利用可能なクーポンはありません</div>
      ) : (
        <ul className="space-y-2 mt-3">
          {items.map((coupon) => (
            <li key={coupon.id} className="sc-card">
              <div className="flex items-center justify-between">
                <span className="sc-badge">{COUPON_STATUS_LABEL[coupon.status]}</span>
                <span className="text-xs text-gray-500">{formatJpDate(coupon.expiresAt)} まで</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExtendActionScreen({ ctx, kind, id }: { ctx: StampCardContext; kind: 'card' | 'coupon'; id: string }) {
  const [result, setResult] = useState<{ ok: boolean; message: string; newExpiresAt?: string } | null>(null);

  useEffect(() => {
    apiPost<{ success: boolean; newExpiresAt: string }>(`/api/liff/${kind === 'card' ? 'cards' : 'coupons'}/${id}/extend`, ctx)
      .then((r) => setResult({ ok: true, message: '有効期限を1週間変更しました。ご来店を心よりお待ちしております！', newExpiresAt: r.newExpiresAt }))
      .catch((err) => {
        const code = (err as { code?: string }).code;
        const message = code === 'already_extended' || code === 'already_used'
          ? 'このカード/クーポンは既に一度延長されています'
          : 'エラーが発生しました。少し時間を置いて再度お試しください。';
        setResult({ ok: false, message });
      });
  }, [ctx, kind, id]);

  if (!result) return <Spinner />;

  return (
    <div className="px-4 py-10 text-center sc-slide-up">
      <div className="sc-card">
        <div className="text-5xl mb-3">{result.ok ? '✅' : '⚠️'}</div>
        <p className="text-sm text-gray-700 leading-relaxed">{result.message}</p>
        {result.newExpiresAt && (
          <p className="text-xs text-gray-500 mt-3">次の期限: {formatJpDate(result.newExpiresAt)}</p>
        )}
      </div>
    </div>
  );
}

type Screen = { kind: 'card' } | { kind: 'coupons' } | { kind: 'extend'; target: 'card' | 'coupon'; id: string };

function App({ ctx, initial }: { ctx: StampCardContext; initial: Screen }) {
  const [screen, setScreen] = useState<Screen>(initial);
  return (
    <div className="min-h-screen" style={{ background: '#f5f5f5' }}>
      <header className="px-4 py-3 text-white text-center font-bold sticky top-0 z-20" style={{ background: '#06C755', fontSize: '15px' }}>
        スタンプカード
      </header>
      <main className="max-w-md mx-auto">
        {screen.kind === 'card' && <CardScreen ctx={ctx} onShowCoupons={() => setScreen({ kind: 'coupons' })} />}
        {screen.kind === 'coupons' && <CouponListScreen ctx={ctx} onBack={() => setScreen({ kind: 'card' })} />}
        {screen.kind === 'extend' && <ExtendActionScreen ctx={ctx} kind={screen.target} id={screen.id} />}
      </main>
    </div>
  );
}

export function mountStampCard(container: HTMLElement, ctx: StampCardContext, initial: Screen): void {
  document.body.classList.add('sc-active');
  if (!_root) _root = createRoot(container);
  _root.render(
    <StrictMode>
      <App ctx={ctx} initial={initial} />
    </StrictMode>,
  );
}
