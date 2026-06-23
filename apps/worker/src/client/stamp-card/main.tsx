// main.tsx — Stamp card LIFF entry. Loaded via dynamic import from
// apps/worker/src/client/main.ts (?page=stamp-card, or ?page=stamp-card&action=extend
// &kind=card|coupon&id=<id> from the expiry-reminder push message button).
// UI/UX rationale: docs/stamp-card-coupon-liff-ux.md
// Mirrors event-booking design language (LINE 緑 + sc-card + fade animations).

import { StrictMode, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import './styles.css';

let _root: Root | null = null;

export interface StampCardContext {
  liffId: string;
  lineUserId: string;
  idToken: string;
}

interface MilestoneInfo {
  threshold: number;
  couponName: string;
  couponDescription: string | null;
  couponImageUrl: string | null;
  alreadyIssued: boolean;
}

interface CardView {
  id: string;
  stampCount: number;
  totalStampCount: number;
  goal: number | null;
  remainingToGoal: number | null;
  rankEnabled: boolean;
  currentRankName: string | null;
  currentRankImageUrl: string | null;
  nextRankName: string | null;
  expiresAt: string | null;
  expirationExtended: boolean;
  canExtend: boolean;
  status: 'active' | 'expired';
  milestones: MilestoneInfo[];
}

interface CardResponse {
  card: CardView;
  reservationUrl: string | null;
  stampImageUrl: string | null;
  rankBadgeLayout: 'split' | 'background';
  stampAngleEnabled: boolean;
  birthday: { year: number | null; month: number; day: number } | null;
}

interface CouponItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
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

async function apiPost<T>(path: string, ctx: StampCardContext, payload?: unknown): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
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

function RankBadge({ card, layout }: { card: CardView; layout: 'split' | 'background' }) {
  if (!card.rankEnabled) return null;
  const palette = paletteFor(card.currentRankName);
  const nextLine = card.nextRankName ? `次のランク: ${card.nextRankName}` : '最高ランクです🎉';

  // 背景全体モード: ランク画像をカード全面に敷き、暗いグラデーションを重ねて文字を読みやすくする。
  if (layout === 'background' && card.currentRankImageUrl) {
    return (
      <div
        className="sc-card text-center sc-rank-badge-bg"
        style={{ backgroundImage: `url(${card.currentRankImageUrl})` }}
      >
        <div className="sc-rank-badge-bg-overlay">
          <div className="text-xs text-white/80">現在のランク</div>
          <div className="text-lg font-bold mt-1 text-white">{card.currentRankName ?? '-'}</div>
          <div className="text-xs mt-2 text-white/80">{nextLine}</div>
        </div>
      </div>
    );
  }

  // 左画像+右テキストモード (画像が無い場合もこちらにフォールバック)。
  if (layout === 'split' && card.currentRankImageUrl) {
    return (
      <div className="sc-card sc-rank-badge-split">
        <img src={card.currentRankImageUrl} alt="" className="sc-rank-badge-image" />
        <div className="text-left flex-1">
          <div className="text-xs" style={{ color: palette.label }}>現在のランク</div>
          <div className="text-lg font-bold mt-1" style={{ color: palette.label }}>{card.currentRankName ?? '-'}</div>
          <div className="text-xs mt-2" style={{ color: palette.label }}>{nextLine}</div>
        </div>
      </div>
    );
  }

  // 画像未設定: 従来のグラデーション単色バッジにフォールバック。
  return (
    <div
      className="sc-card text-center"
      style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
    >
      <div className="text-xs" style={{ color: palette.label }}>現在のランク</div>
      <div className="text-lg font-bold mt-1" style={{ color: palette.label }}>
        {card.currentRankName ?? '-'}
      </div>
      <div className="text-xs mt-2" style={{ color: palette.label }}>{nextLine}</div>
    </div>
  );
}

// document.body 直下にポータルで描画する — 親要素のアニメーション (transform を残すsc-fade-in等) が
// position:fixed の containing block を書き換えてしまい、黒背景オーバーレイが画面下まで届かなくなる
// 問題を避けるため (祖先にtransformが指定されると inset:0 はその祖先基準になってしまう)。
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="sc-modal-overlay" onClick={onClose}>
      <div className="sc-modal-card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function MilestonePopup({ milestone, onClose }: { milestone: MilestoneInfo; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      {milestone.couponImageUrl && (
        <img src={milestone.couponImageUrl} alt="" className="sc-modal-image" />
      )}
      <div className="p-4">
        <div className="text-xs text-gray-500">{milestone.threshold}個達成でもらえる特典</div>
        <div className="text-base font-bold text-gray-900 mt-1">{milestone.couponName}</div>
        {milestone.couponDescription && (
          <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{milestone.couponDescription}</p>
        )}
        <div className="mt-3">
          {milestone.alreadyIssued ? (
            <span className="sc-badge" style={{ background: '#ecfdf5', color: '#047857' }}>獲得済み🎁</span>
          ) : (
            <span className="sc-badge">あと{milestone.threshold}個達成で獲得できます</span>
          )}
        </div>
        <button onClick={onClose} className="sc-secondary-btn mt-4">閉じる</button>
      </div>
    </Modal>
  );
}

const COUPON_STATUS_LABEL: Record<CouponItem['status'], string> = {
  unused: '未使用', used: '使用済み', expired: '期限切れ',
};

// ── 営業日カレンダー ──────────────────────────────────────────────

interface CalendarEventInfo { date: string; title: string }
interface CalendarCouponExpiry { date: string; coupons: Array<{ id: string; name: string }> }
interface CalendarResponse {
  month: string; // "YYYY-MM"
  canGoPrev: boolean;
  canGoNext: boolean;
  events: CalendarEventInfo[];
  couponExpiries: CalendarCouponExpiry[];
  cardExpiryDate: string | null;
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

interface DayMarkers {
  eventTitles: string[];
  couponNames: string[];
  cardExpiry: boolean;
}

// リッチメニュー単独画面 (action=calendar) とスタンプカード画面への埋め込みの両方から使う、
// 月送り付きの予定/有効期限カレンダー。マーカーのある日をタップすると詳細をポップアップ表示する。
function CalendarWidget({ ctx }: { ctx: StampCardContext }) {
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = monthOverride ? `/api/liff/calendar?month=${monthOverride}` : '/api/liff/calendar';
    apiGet<CalendarResponse>(path, ctx)
      .then((r) => { if (!cancelled) { setData(r); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [ctx, monthOverride]);

  if (error) return <div className="sc-card text-center text-sm text-gray-500 mt-4">カレンダーを読み込めませんでした</div>;
  if (!data) return <div className="text-center text-sm text-gray-400 mt-4">カレンダーを読み込み中...</div>;

  const [y, m] = data.month.split('-').map(Number); // m: 1-indexed
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0=日
  const daysInMonth = new Date(y, m, 0).getDate();

  const markersByDate = new Map<string, DayMarkers>();
  const markerFor = (date: string): DayMarkers => {
    let entry = markersByDate.get(date);
    if (!entry) {
      entry = { eventTitles: [], couponNames: [], cardExpiry: false };
      markersByDate.set(date, entry);
    }
    return entry;
  };
  for (const e of data.events) markerFor(e.date).eventTitles.push(e.title);
  for (const ce of data.couponExpiries) markerFor(ce.date).couponNames.push(...ce.coupons.map((c) => c.name));
  if (data.cardExpiryDate) markerFor(data.cardExpiryDate).cardExpiry = true;

  const cells: Array<{ day: number; date: string } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }

  const selected = selectedDate ? markersByDate.get(selectedDate) : null;

  return (
    <div className="sc-card mt-4">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setMonthOverride(shiftMonthKey(data.month, -1))}
          disabled={!data.canGoPrev}
          className="sc-calendar-nav-btn"
          aria-label="前の月"
        >
          ←
        </button>
        <div className="text-sm font-bold text-gray-900">{y}年{m}月</div>
        <button
          onClick={() => setMonthOverride(shiftMonthKey(data.month, 1))}
          disabled={!data.canGoNext}
          className="sc-calendar-nav-btn"
          aria-label="次の月"
        >
          →
        </button>
      </div>
      <div className="sc-calendar-grid">
        {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
          <div key={w} className="sc-calendar-weekday">{w}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} />;
          const markers = markersByDate.get(cell.date);
          const hasMarker = !!markers && (markers.eventTitles.length > 0 || markers.couponNames.length > 0 || markers.cardExpiry);
          return (
            <button
              key={cell.date}
              onClick={() => hasMarker && setSelectedDate(cell.date)}
              className={`sc-calendar-cell ${hasMarker ? 'sc-calendar-cell-marked' : ''}`}
            >
              <span>{cell.day}</span>
              {hasMarker && (
                <span className="sc-calendar-marker-icons">
                  {markers!.eventTitles.length > 0 && '📅'}
                  {markers!.couponNames.length > 0 && '🎟️'}
                  {markers!.cardExpiry && '🏷️'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && selected && (
        <Modal onClose={() => setSelectedDate(null)}>
          <div className="p-4">
            <div className="text-sm font-bold text-gray-900 mb-2">{formatJpDate(selectedDate)}</div>
            {selected.eventTitles.map((title, i) => (
              <div key={i} className="text-sm text-gray-700 mb-1">📅 {title}</div>
            ))}
            {selected.couponNames.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-bold" style={{ color: '#e11d48' }}>この日が有効期限のクーポン</div>
                {selected.couponNames.map((name, i) => (
                  <div key={i} className="text-sm text-gray-700">🎟️ {name}</div>
                ))}
              </div>
            )}
            {selected.cardExpiry && (
              <div className="text-sm mt-2" style={{ color: '#e11d48' }}>🏷️ ショップカードの有効期限です</div>
            )}
            <button onClick={() => setSelectedDate(null)} className="sc-secondary-btn mt-4">閉じる</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CalendarScreen({ ctx, onBack }: { ctx: StampCardContext; onBack: () => void }) {
  return (
    <div className="px-4 py-4 pb-10 sc-fade-in">
      <button onClick={onBack} className="sc-back-btn">← 戻る</button>
      <CalendarWidget ctx={ctx} />
    </div>
  );
}

interface CouponDetailInfo {
  name: string;
  description: string | null;
  imageUrl: string | null;
  status?: CouponItem['status'];
  expiresAt: string;
}

// 保有クーポンをタップした際の詳細ポップアップ。お客様のクーポン一覧・スタッフのスタンプ付与確認画面の両方で使う。
function CouponDetailPopup({ coupon, onClose }: { coupon: CouponDetailInfo; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      {coupon.imageUrl && (
        <img src={coupon.imageUrl} alt="" className="sc-modal-image" />
      )}
      <div className="p-4">
        {coupon.status && <span className="sc-badge">{COUPON_STATUS_LABEL[coupon.status]}</span>}
        <div className="text-base font-bold text-gray-900 mt-1">{coupon.name}</div>
        {coupon.description && (
          <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{coupon.description}</p>
        )}
        <div className="text-xs text-gray-500 mt-3">有効期限: {formatJpDate(coupon.expiresAt)} まで</div>
        <button onClick={onClose} className="sc-secondary-btn mt-4">閉じる</button>
      </div>
    </Modal>
  );
}

// 紙のショップカードを模した「マス目にスタンプがポンと押される」見た目。
// goal が無い (フリー集計) 店舗ではマス目を描けないので数字表示にフォールバックする。
// 0.5刻みの半分スタンプ (雨の日1.5倍等) は、該当マスの左半分だけ画像/印を見せて表現する。
// マイルストーン (ランク内の中間到達報酬) が設定されたマスには🎁印を重ね、タップで詳細を表示する。
function StampGrid({ card, stampImageUrl, stampAngleEnabled }: { card: CardView; stampImageUrl: string | null; stampAngleEnabled: boolean }) {
  const goal = card.goal;
  const [activeMilestone, setActiveMilestone] = useState<MilestoneInfo | null>(null);
  const fullCount = Math.floor(card.stampCount);
  const hasHalf = card.stampCount - fullCount >= 0.5 - 1e-9 && card.stampCount - fullCount < 1 - 1e-9;

  const milestoneBySlot = new Map<number, MilestoneInfo>();
  for (const m of card.milestones) {
    const slotIndex = Math.ceil(m.threshold) - 1; // しきい値が小数でも、到達するマス (切り上げ) に印を置く
    milestoneBySlot.set(slotIndex, m);
  }

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
            const filled = i < fullCount;
            const half = !filled && i === fullCount && hasHalf;
            const milestone = milestoneBySlot.get(i);
            return (
              <div key={i} className={`sc-stamp-slot ${stampAngleEnabled ? '' : 'sc-stamp-no-angle'}`}>
                {/* スタンプ画像/印のクリップ (円形・半分カット) はこの内側ラッパーだけに適用し、
                    外側のスロットには overflow:hidden を持たせない — マイルストーン印がマス角に
                    はみ出して配置される際に、自身のクリップで欠けてしまうのを防ぐため。 */}
                <div
                  className={`sc-stamp-fill ${filled ? 'sc-stamp-slot-filled' : ''} ${half ? 'sc-stamp-slot-half' : ''}`}
                  style={filled || half ? { animationDelay: `${i * 60}ms` } : undefined}
                >
                  {(filled || half) && (stampImageUrl ? (
                    <img src={stampImageUrl} alt="" className="sc-stamp-image" />
                  ) : (
                    <span className="sc-stamp-mark">済</span>
                  ))}
                </div>
                {milestone && (
                  <button
                    className="sc-milestone-marker"
                    onClick={() => setActiveMilestone(milestone)}
                    aria-label="このマスで獲得できる特典を見る"
                  >
                    🎁
                  </button>
                )}
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
      {card.milestones.length > 0 && (
        <div className="text-xs text-gray-400 mt-1">🎁印のマスをタップすると、もらえる特典が見られます</div>
      )}

      {activeMilestone && <MilestonePopup milestone={activeMilestone} onClose={() => setActiveMilestone(null)} />}
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
      <div className="text-xs text-orange-700">期限が近づいています</div>
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

function BirthdaySection({
  ctx,
  birthday,
  onSaved,
}: {
  ctx: StampCardContext;
  birthday: { year: number | null; month: number; day: number } | null;
  onSaved: (b: { year: number | null; month: number; day: number }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [year, setYear] = useState<string>(birthday?.year ? String(birthday.year) : '');
  const [month, setMonth] = useState(birthday?.month ?? 1);
  const [day, setDay] = useState(birthday?.day ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = { year: year ? Number(year) : null, month, day };
      await apiPost('/api/liff/friends/me/birthday', ctx, payload);
      onSaved(payload);
      setEditing(false);
    } catch {
      setError('保存に失敗しました。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="sc-card mt-3 flex items-center justify-between">
        <span className="text-sm text-gray-700">
          {birthday ? `誕生日: ${birthday.month}月${birthday.day}日` : '誕生日が未登録です（誕生月の特典が受け取れます）'}
        </span>
        <button onClick={() => setEditing(true)} className="text-xs sc-line-green-text underline shrink-0">
          {birthday ? '編集' : '登録する'}
        </button>
      </div>
    );
  }

  return (
    <div className="sc-card mt-3">
      <div className="text-xs text-gray-600 mb-2">誕生日を登録（誕生月限定の特典に使われます）</div>
      <div className="flex gap-2 items-end">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">年（任意）</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="例: 1990" className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">月</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">日</label>
          <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button onClick={save} disabled={busy} className="text-xs rounded-md bg-emerald-600 px-3 py-2 text-white shrink-0">
          {busy ? '保存中...' : '保存'}
        </button>
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <button onClick={() => setEditing(false)} className="text-xs text-gray-500 underline mt-2">キャンセル</button>
    </div>
  );
}

function CardScreen({ ctx, onShowCoupons, onShowQr }: { ctx: StampCardContext; onShowCoupons: () => void; onShowQr: () => void }) {
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

  const { card, reservationUrl, stampImageUrl, rankBadgeLayout, stampAngleEnabled, birthday } = data;

  return (
    <div className="px-4 py-4 pb-10 sc-fade-in">
      <RankBadge card={card} layout={rankBadgeLayout} />
      <StampGrid card={card} stampImageUrl={stampImageUrl} stampAngleEnabled={stampAngleEnabled} />
      {card.expiresAt && (
        <div className="text-xs text-gray-500 mt-2 text-right">
          カードの有効期限: {formatJpDate(card.expiresAt)} まで
        </div>
      )}
      <BirthdaySection ctx={ctx} birthday={birthday} onSaved={(b) => setData((d) => (d ? { ...d, birthday: b } : d))} />
      {extendedAt ? <ExtendedNotice newExpiresAt={extendedAt} /> : <ExtendSection ctx={ctx} card={card} onExtended={setExtendedAt} />}
      <button onClick={onShowQr} className="sc-primary-btn mt-3">
        スタッフにスタンプを押してもらう
      </button>
      {reservationUrl && (
        <a href={reservationUrl} className="sc-secondary-btn mt-2 block text-center">
          予約する
        </a>
      )}
      <div className="text-center mt-5">
        <button onClick={onShowCoupons} className="text-sm sc-line-green-text underline">
          保有しているクーポンを見る
        </button>
      </div>
      <CalendarWidget ctx={ctx} />
    </div>
  );
}

function QrScreen({ ctx, liffId, onBack }: { ctx: StampCardContext; liffId: string; onBack: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchToken() {
    setError(null);
    setToken(null);
    try {
      const res = await apiGet<{ success: boolean; data: { token: string; expiresAt: number } }>(
        '/api/liff/stamp-cards/qr-token',
        ctx,
      );
      setToken(res.data.token);
      setExpiresAt(res.data.expiresAt);
    } catch {
      setError('QRコードの発行に失敗しました');
    }
  }

  useEffect(() => { void fetchToken(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const expired = expiresAt != null && expiresAt * 1000 < Date.now();
  const qrUrl = token && !expired
    ? `https://liff.line.me/${liffId}?page=stamp-card&action=grant&token=${encodeURIComponent(token)}`
    : '';

  return (
    <div className="px-4 py-6 text-center sc-fade-in">
      <button onClick={onBack} className="sc-back-btn mb-4">← 戻る</button>
      <div className="sc-card">
        <p className="text-sm text-gray-600 mb-4">このQRコードをレジでスタッフにお見せください</p>
        {qrUrl ? (
          <div className="flex justify-center py-2">
            <QRCodeSVG value={qrUrl} size={220} />
          </div>
        ) : (
          <div className="py-12 text-sm text-gray-400">{error ?? '発行中...'}</div>
        )}
        <button onClick={() => void fetchToken()} className="text-xs sc-line-green-text underline mt-4">
          {expired ? '期限切れ — 再発行する' : 'QRを再発行する'}
        </button>
        <p className="text-xs text-gray-400 mt-2">5分間有効です</p>
      </div>
    </div>
  );
}

interface GrantPreview {
  friend: { displayName: string | null; pictureUrl: string | null };
  card: { stampCount: number; currentRankName: string | null };
  stampRuleType: 'per_visit' | 'per_amount';
  amountPerStamp: number | null;
  activeMultiplier: { multiplier: number; appliedRuleNames: string[] };
  coupons: Array<{ id: string; name: string; description: string | null; imageUrl: string | null; expiresAt: string; usagePolicy: 'single_use' | 'unlimited_in_period'; redemptionCount: number | null }>;
  stampLogs: Array<{ id: string; source: string; finalPoints: number; multiplierApplied: number; createdAt: string }>;
  couponHistory: Array<{ id: string; name: string; status: 'unused' | 'used' | 'expired'; issuedAt: string; expiresAt: string; usedAt: string | null }>;
}

const COUPON_HISTORY_STATUS_LABEL: Record<'unused' | 'used' | 'expired', string> = {
  unused: '未使用', used: '使用済み', expired: '期限切れ',
};

function formatJpDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function HistorySection({ preview }: { preview: GrantPreview }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sc-card mt-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-xs text-gray-600">
        <span>このお客様の利用履歴を見る</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-xs text-gray-500 mb-1.5">スタンプ付与履歴</div>
            {preview.stampLogs.length === 0 ? (
              <div className="text-xs text-gray-400">まだ履歴がありません</div>
            ) : (
              <ul className="space-y-1">
                {preview.stampLogs.map((log) => (
                  <li key={log.id} className="text-xs text-gray-600 flex justify-between">
                    <span>{formatJpDateTime(log.createdAt)}</span>
                    <span>+{log.finalPoints}pt{log.multiplierApplied !== 1 ? `（${log.multiplierApplied}倍）` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1.5">クーポン履歴</div>
            {preview.couponHistory.length === 0 ? (
              <div className="text-xs text-gray-400">まだ履歴がありません</div>
            ) : (
              <ul className="space-y-1">
                {preview.couponHistory.map((cp) => (
                  <li key={cp.id} className="text-xs text-gray-600 flex justify-between gap-2">
                    <span className="truncate">{cp.name}</span>
                    <span className="shrink-0">
                      {COUPON_HISTORY_STATUS_LABEL[cp.status]}
                      {cp.status === 'used' && cp.usedAt ? `（${formatJpDateTime(cp.usedAt)}）` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(new URL(path, window.location.origin).toString(), init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error((body as { error?: string }).error ?? `API ${res.status}`) as Error & { code?: string };
    err.code = (body as { error?: string }).error;
    throw err;
  }
  return body;
}

function describeOperatorError(code: string | undefined): string {
  if (code === 'operator_not_registered') return 'このLINEアカウントはスタンプ付与の権限がありません。管理画面で発行した登録用QRを先に読み込んでください。';
  if (code === 'operator_unauthenticated') return 'LINE認証に失敗しました。LINEアプリ内で開き直してください。';
  if (code === 'invalid_or_expired_token') return 'QRコードの有効期限が切れています。お客様にもう一度QRを表示してもらってください。';
  return 'エラーが発生しました。少し時間を置いて再度お試しください。';
}

// スタッフがQRをスキャンして開く画面。トークンに加え、スキャンした側 (idToken) が
// 登録済みオペレーターかどうかをサーバ側で必ず確認する (不正利用防止、要件⑤と同様の超重要ポイント)。
function GrantScreen({ ctx, token }: { ctx: StampCardContext; token: string }) {
  const [preview, setPreview] = useState<GrantPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(1000);
  const [points, setPoints] = useState(1);
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState<{ stampCount: number; rankedUp: boolean; issuedCoupon: boolean } | null>(null);
  const [redeemedIds, setRedeemedIds] = useState<Set<string>>(new Set());
  const [redemptionCounts, setRedemptionCounts] = useState<Record<string, number>>({});
  const [activeCoupon, setActiveCoupon] = useState<GrantPreview['coupons'][number] | null>(null);
  const [pendingRedeem, setPendingRedeem] = useState<GrantPreview['coupons'][number] | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    fetchJson<{ success: boolean; data: GrantPreview }>(
      `/api/liff/stamp-cards/grant-preview?token=${encodeURIComponent(token)}`,
      { headers: buildAuthHeaders(ctx) },
    )
      .then((r) => setPreview(r.data))
      .catch((e) => setError(describeOperatorError((e as { code?: string }).code)));
  }, [token, ctx]);

  async function grant() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ success: boolean; data: { stampCount: number; rankedUp: boolean; issuedCoupon: boolean } }>(
        '/api/liff/stamp-cards/grant',
        {
          method: 'POST',
          headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            token,
            amountYen: preview?.stampRuleType === 'per_amount' ? amount : undefined,
            points: preview?.stampRuleType === 'per_visit' ? points : undefined,
          }),
        },
      );
      setGranted(res.data);
    } catch (e) {
      setError(describeOperatorError((e as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  }

  async function redeem(couponId: string, usagePolicy: 'single_use' | 'unlimited_in_period') {
    try {
      const res = await fetchJson<{ success: boolean; data: { redemptionCount: number | null } }>(`/api/liff/coupons/${couponId}/redeem`, {
        method: 'POST',
        headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ token }),
      });
      if (usagePolicy === 'unlimited_in_period') {
        setRedemptionCounts((m) => ({ ...m, [couponId]: res.data.redemptionCount ?? (m[couponId] ?? 0) + 1 }));
      } else {
        setRedeemedIds((s) => new Set(s).add(couponId));
      }
    } catch (e) {
      setError(describeOperatorError((e as { code?: string }).code));
    }
  }

  // 誤タップ防止: ボタンを押した直後にはまだ消し込まず、確認ポップアップでの再タップを必須にする。
  async function confirmRedeem() {
    if (!pendingRedeem) return;
    setRedeeming(true);
    try {
      await redeem(pendingRedeem.id, pendingRedeem.usagePolicy);
    } finally {
      setRedeeming(false);
      setPendingRedeem(null);
    }
  }

  if (error && !preview) return <div className="px-4 py-6"><div className="sc-card text-center text-sm text-gray-600">{error}</div></div>;
  if (!preview) return <Spinner />;

  // 実際の付与計算 (grantStamp) と同じ式で、リアルタイムに「合計付与ポイント」を見せる。
  const projectedBasePoints = preview.stampRuleType === 'per_amount'
    ? Math.floor(amount / (preview.amountPerStamp ?? 1000))
    : points;
  const projectedFinalPoints = Math.round(projectedBasePoints * preview.activeMultiplier.multiplier * 2) / 2;

  return (
    <div className="px-4 py-4 pb-10 sc-fade-in">
      <div className="sc-card text-center">
        <div className="text-sm text-gray-500">お客様</div>
        <div className="text-lg font-bold text-gray-900 mt-1">{preview.friend.displayName ?? '(表示名なし)'}</div>
        <div className="text-xs text-gray-500 mt-2">
          現在 {preview.card.stampCount}pt {preview.card.currentRankName ? `（${preview.card.currentRankName}）` : ''}
        </div>
      </div>

      {granted ? (
        <div className="sc-extend-card sc-extend-done mt-3 text-center">
          <div className="text-sm font-bold text-emerald-700">スタンプを付与しました</div>
          <div className="text-xs text-emerald-700 mt-1">現在 {granted.stampCount}pt</div>
          {granted.rankedUp && <div className="text-xs text-emerald-700 mt-1">🎉 ランクアップしました</div>}
          {granted.issuedCoupon && <div className="text-xs text-emerald-700 mt-1">🎁 クーポンを発行しました</div>}
        </div>
      ) : (
        <div className="sc-card mt-3">
          {preview.activeMultiplier.multiplier !== 1 && (
            <div className="mb-3 text-xs rounded-lg bg-amber-50 text-amber-800 px-3 py-2">
              現在適用中のポイント倍率: ×{preview.activeMultiplier.multiplier}
              {preview.activeMultiplier.appliedRuleNames.length > 0 && `（${preview.activeMultiplier.appliedRuleNames.join(' + ')}）`}
            </div>
          )}
          {preview.stampRuleType === 'per_amount' && (
            <div className="mb-3">
              <label className="block text-xs text-gray-600 mb-1">利用金額（円）</label>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}
          {preview.stampRuleType === 'per_visit' && (
            <div className="mb-3">
              <label className="block text-xs text-gray-600 mb-1">付与ポイント数（0.5刻みで指定できます）</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}
          <div className="text-xs text-gray-500 mb-3">
            合計付与ポイント: <span className="font-bold text-gray-900">{projectedFinalPoints}pt</span>
            {preview.activeMultiplier.multiplier !== 1 && (
              <span className="text-gray-400">
                {' '}（{preview.stampRuleType === 'per_amount' ? projectedBasePoints : points} × {preview.activeMultiplier.multiplier}）
              </span>
            )}
          </div>
          {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
          <button onClick={grant} disabled={busy} className="sc-primary-btn">
            {busy ? '処理中...' : 'スタンプを付与する'}
          </button>
        </div>
      )}

      {preview.coupons.length > 0 && (
        <div className="sc-card mt-3">
          <div className="text-xs text-gray-500 mb-2">保有クーポン（タップで詳細表示）</div>
          <ul className="space-y-2">
            {preview.coupons.map((cp) => (
              <li key={cp.id} className="flex items-center justify-between gap-2">
                <button onClick={() => setActiveCoupon(cp)} className="text-xs text-gray-700 truncate underline text-left">
                  {cp.name}<span className="text-gray-400">（{formatJpDate(cp.expiresAt)}まで）</span>
                </button>
                {cp.usagePolicy === 'unlimited_in_period' ? (
                  <button onClick={() => setPendingRedeem(cp)} className="text-xs rounded-md bg-emerald-600 px-3 py-1.5 text-white shrink-0">
                    利用する（利用回数: {redemptionCounts[cp.id] ?? cp.redemptionCount ?? 0}）
                  </button>
                ) : redeemedIds.has(cp.id) ? (
                  <span className="text-xs text-emerald-700 shrink-0">使用済みにしました✓</span>
                ) : (
                  <button onClick={() => setPendingRedeem(cp)} className="text-xs rounded-md bg-emerald-600 px-3 py-1.5 text-white shrink-0">
                    使用済みにする
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <HistorySection preview={preview} />

      {activeCoupon && (
        <CouponDetailPopup
          coupon={{ name: activeCoupon.name, description: activeCoupon.description, imageUrl: activeCoupon.imageUrl, expiresAt: activeCoupon.expiresAt }}
          onClose={() => setActiveCoupon(null)}
        />
      )}

      {pendingRedeem && (
        <Modal onClose={() => setPendingRedeem(null)}>
          <div className="p-4 text-center">
            <div className="text-sm font-bold text-gray-900">
              {pendingRedeem.usagePolicy === 'unlimited_in_period' ? 'このクーポンを1回利用しますか？' : '本当にクーポンを使用済みにしますか？'}
            </div>
            <div className="text-xs text-gray-600 mt-2">{pendingRedeem.name}</div>
            {pendingRedeem.usagePolicy !== 'unlimited_in_period' && (
              <div className="text-xs text-red-600 mt-2">この操作は取り消せません。</div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setPendingRedeem(null)} disabled={redeeming} className="flex-1 sc-secondary-btn">キャンセル</button>
              <button onClick={confirmRedeem} disabled={redeeming} className="flex-1 sc-primary-btn">
                {redeeming ? '処理中...' : '使用する'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// 「スタンプ付与スタッフ登録用QR」をスキャンして開く画面 (一度だけ)。
function RegisterOperatorScreen({ ctx, token }: { ctx: StampCardContext; token: string }) {
  const [state, setState] = useState<'pending' | 'done' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson('/api/liff/stamp-cards/register-operator', {
      method: 'POST',
      headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token }),
    })
      .then(() => setState('done'))
      .catch((e) => {
        setState('error');
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [token, ctx]);

  return (
    <div className="px-4 py-10 text-center sc-slide-up">
      <div className="sc-card">
        {state === 'pending' && <Spinner />}
        {state === 'done' && (
          <>
            <div className="text-5xl mb-3">✅</div>
            <p className="text-sm text-gray-700">スタンプ付与スタッフとして登録しました。</p>
            <p className="text-xs text-gray-500 mt-2">これでお客様のQRを読んでスタンプを付与できます。</p>
          </>
        )}
        {state === 'error' && (
          <>
            <div className="text-5xl mb-3">⚠️</div>
            <p className="text-sm text-gray-700">{error ?? '登録に失敗しました'}</p>
          </>
        )}
      </div>
    </div>
  );
}

function CouponListScreen({ ctx, onBack }: { ctx: StampCardContext; onBack: () => void }) {
  const [items, setItems] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCoupon, setActiveCoupon] = useState<CouponItem | null>(null);

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
            <li key={coupon.id}>
              <button onClick={() => setActiveCoupon(coupon)} className="sc-card !p-0 overflow-hidden w-full text-left block">
                <div className="flex">
                  {coupon.imageUrl ? (
                    <img src={coupon.imageUrl} alt="" className="w-20 self-stretch object-cover shrink-0" />
                  ) : (
                    <div className="w-20 self-stretch bg-gradient-to-br from-green-100 to-green-200 shrink-0 flex items-center justify-center text-2xl">🎟️</div>
                  )}
                  <div className="flex-1 min-w-0 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-gray-900 line-clamp-2">{coupon.name}</div>
                      <span className="sc-badge shrink-0">{COUPON_STATUS_LABEL[coupon.status]}</span>
                    </div>
                    {coupon.description && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{coupon.description}</p>
                    )}
                    <div className="text-xs text-gray-400 mt-1">{formatJpDate(coupon.expiresAt)} まで</div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeCoupon && <CouponDetailPopup coupon={activeCoupon} onClose={() => setActiveCoupon(null)} />}
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

type Screen =
  | { kind: 'card' }
  | { kind: 'coupons' }
  | { kind: 'calendar' }
  | { kind: 'extend'; target: 'card' | 'coupon'; id: string }
  | { kind: 'qr' }
  | { kind: 'grant'; token: string }
  | { kind: 'registerOperator'; token: string };

function App({ ctx, initial }: { ctx: StampCardContext; initial: Screen }) {
  const [screen, setScreen] = useState<Screen>(initial);
  return (
    <div className="min-h-screen" style={{ background: '#f5f5f5' }}>
      <header className="px-4 py-3 text-white text-center font-bold sticky top-0 z-20" style={{ background: '#06C755', fontSize: '15px' }}>
        スタンプカード
      </header>
      <main className="max-w-md mx-auto">
        {screen.kind === 'card' && (
          <CardScreen
            ctx={ctx}
            onShowCoupons={() => setScreen({ kind: 'coupons' })}
            onShowQr={() => setScreen({ kind: 'qr' })}
          />
        )}
        {screen.kind === 'coupons' && <CouponListScreen ctx={ctx} onBack={() => setScreen({ kind: 'card' })} />}
        {screen.kind === 'calendar' && <CalendarScreen ctx={ctx} onBack={() => setScreen({ kind: 'card' })} />}
        {screen.kind === 'extend' && <ExtendActionScreen ctx={ctx} kind={screen.target} id={screen.id} />}
        {screen.kind === 'qr' && <QrScreen ctx={ctx} liffId={ctx.liffId} onBack={() => setScreen({ kind: 'card' })} />}
        {screen.kind === 'grant' && <GrantScreen ctx={ctx} token={screen.token} />}
        {screen.kind === 'registerOperator' && <RegisterOperatorScreen ctx={ctx} token={screen.token} />}
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
