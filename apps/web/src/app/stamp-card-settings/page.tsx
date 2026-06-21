'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import ImageUploader from '@/components/shared/image-uploader'
import { api, type CardSettings, type CardRank } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const EMPTY: CardSettings = {
  line_account_id: '',
  stamp_rule_type: 'per_visit',
  amount_per_stamp: null,
  signup_bonus_stamps: 0,
  rank_enabled: 0,
  flat_goal_stamps: 5,
  card_expiry_months: null,
  card_expiry_mode: 'since_last_stamp',
  card_expiry_days_from_issue: null,
  card_expiry_self_extension_enabled: 1,
  card_expiry_penalty_type: 'none',
  card_expiry_penalty_target_rank_id: null,
  stamp_angle_enabled: 1,
  multiplier_combination_mode: 'highest_priority_only',
  friend_anniversary_multiplier_enabled: 0,
  friend_anniversary_multiplier_value: 1.5,
  friend_anniversary_reminder_message: null,
  birthday_coupon_enabled: 0,
  birthday_coupon_template_id: null,
  default_coupon_validity_days: 30,
  reminder_days_before: 3,
  reservation_url: null,
  stamp_image_url: null,
  shop_latitude: null,
  shop_longitude: null,
  shop_address: null,
  weather_check_interval_minutes: 30,
  weather_check_anchor_time: '00:00',
  rank_badge_layout: 'split',
}

export default function StampCardSettingsPage() {
  const { selectedAccount, loading: accountLoading } = useAccount()
  const [form, setForm] = useState<CardSettings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [addressInput, setAddressInput] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMessage, setGeocodeMessage] = useState('')
  const [ranks, setRanks] = useState<CardRank[]>([])

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true)
    setError('')
    Promise.all([
      api.cardSettings.get(selectedAccount.id),
      api.cardRanks.list(selectedAccount.id),
    ]).then(([settingsRes, ranksRes]) => {
      if (settingsRes.success) {
        setForm(settingsRes.data)
        setAddressInput(settingsRes.data.shop_address ?? '')
      } else {
        setError(settingsRes.error)
      }
      if (ranksRes.success) setRanks(ranksRes.data)
      setLoading(false)
    })
  }, [selectedAccount])

  async function geocodeAddress() {
    if (!selectedAccount || !addressInput) return
    setGeocoding(true)
    setGeocodeMessage('')
    setError('')
    try {
      const res = await api.cardSettings.geocodeAddress(selectedAccount.id, addressInput)
      if (res.success) {
        setForm(res.data)
        setGeocodeMessage(`位置情報を取得しました（緯度${res.data.shop_latitude}, 経度${res.data.shop_longitude}）`)
      } else {
        setGeocodeMessage('位置情報の取得に失敗しました。住所表記を見直してください。')
      }
    } finally {
      setGeocoding(false)
    }
  }

  function set<K extends keyof CardSettings>(key: K, value: CardSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function save() {
    if (!selectedAccount) return
    setSaving(true)
    setError('')
    try {
      const res = await api.cardSettings.update(selectedAccount.id, {
        stamp_rule_type: form.stamp_rule_type,
        amount_per_stamp: form.stamp_rule_type === 'per_amount' ? form.amount_per_stamp : null,
        signup_bonus_stamps: form.signup_bonus_stamps,
        rank_enabled: form.rank_enabled,
        flat_goal_stamps: form.flat_goal_stamps,
        card_expiry_months: form.card_expiry_months,
        card_expiry_mode: form.card_expiry_mode,
        card_expiry_days_from_issue: form.card_expiry_days_from_issue,
        card_expiry_self_extension_enabled: form.card_expiry_self_extension_enabled,
        card_expiry_penalty_type: form.card_expiry_penalty_type,
        card_expiry_penalty_target_rank_id: form.card_expiry_penalty_type === 'drop_to_rank' ? form.card_expiry_penalty_target_rank_id : null,
        stamp_angle_enabled: form.stamp_angle_enabled,
        default_coupon_validity_days: form.default_coupon_validity_days,
        reminder_days_before: form.reminder_days_before,
        reservation_url: form.reservation_url,
        stamp_image_url: form.stamp_image_url,
        weather_check_interval_minutes: form.weather_check_interval_minutes,
        weather_check_anchor_time: form.weather_check_anchor_time,
        rank_badge_layout: form.rank_badge_layout,
      })
      if (res.success) {
        setForm(res.data)
        setSaved(true)
      } else {
        setError(res.error)
      }
    } finally {
      setSaving(false)
    }
  }

  if (accountLoading || (loading && selectedAccount)) {
    return (
      <div>
        <Header title="スタンプカード設定" />
        <div className="p-6 text-sm text-gray-500">読み込み中...</div>
      </div>
    )
  }

  if (!selectedAccount) {
    return (
      <div>
        <Header title="スタンプカード設定" />
        <div className="p-6 text-sm text-gray-500">LINEアカウントを選択してください</div>
      </div>
    )
  }

  return (
    <div>
      <Header title="スタンプカード設定" />
      <div className="p-6 max-w-2xl space-y-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <Section title="スタンプ付与ルール">
          <Field label="付与方式">
            <select
              value={form.stamp_rule_type}
              onChange={(e) => set('stamp_rule_type', e.target.value as CardSettings['stamp_rule_type'])}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="per_visit">来店ごとに1pt</option>
              <option value="per_amount">利用金額ごとに1pt</option>
            </select>
          </Field>
          {form.stamp_rule_type === 'per_amount' && (
            <Field label="何円ごとに1pt付与するか">
              <input
                type="number"
                min={1}
                value={form.amount_per_stamp ?? ''}
                onChange={(e) => set('amount_per_stamp', e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 1000"
              />
            </Field>
          )}
          <Field label="新規カード発行時の発行時ボーナス（pt）">
            <input
              type="number"
              min={0}
              value={form.signup_bonus_stamps}
              onChange={(e) => set('signup_bonus_stamps', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </Field>
        </Section>

        <Section title="ゴール / ランク">
          <Field label="ランクアップ機能">
            <select
              value={form.rank_enabled ? '1' : '0'}
              onChange={(e) => set('rank_enabled', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="0">OFF（単一ゴール）</option>
              <option value="1">ON（ブロンズ/シルバー…の複数ランク）</option>
            </select>
          </Field>
          {!form.rank_enabled && (
            <Field label="ゴールまでのスタンプ数">
              <input
                type="number"
                min={1}
                value={form.flat_goal_stamps ?? ''}
                onChange={(e) => set('flat_goal_stamps', e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </Field>
          )}
          {!!form.rank_enabled && (
            <>
              <p className="text-xs text-gray-500">
                各ランクのゴール数・画像・中間報酬の設定は「ランク管理」画面で行います。
              </p>
              <Field label="ランクバッジの見せ方">
                <select
                  value={form.rank_badge_layout}
                  onChange={(e) => set('rank_badge_layout', e.target.value as CardSettings['rank_badge_layout'])}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="split">左に画像 + 右にランク名（画像未設定のランクは色だけのバッジ）</option>
                  <option value="background">画像を背景全体に敷いて、上に文字を重ねる</option>
                </select>
              </Field>
            </>
          )}
        </Section>

        <Section title="スタンプ画像">
          <ImageUploader
            mode="url"
            value={form.stamp_image_url ? { mode: 'url', url: form.stamp_image_url } : null}
            onChange={(v) => set('stamp_image_url', v?.mode === 'url' ? v.url : null)}
            label="スタンプが押されたマスに表示する画像（未設定なら「済」のテキストスタンプ）"
          />
          <Field label="スタンプの向き">
            <select
              value={form.stamp_angle_enabled ? '1' : '0'}
              onChange={(e) => set('stamp_angle_enabled', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="1">斜め（紙のスタンプカードらしい見た目）</option>
              <option value="0">まっすぐ（角度をつけない）</option>
            </select>
          </Field>
        </Section>

        <Section title="有効期限 / リマインド">
          <Field label="有効期限の基準">
            <select
              value={form.card_expiry_mode}
              onChange={(e) => set('card_expiry_mode', e.target.value as CardSettings['card_expiry_mode'])}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="since_last_stamp">最終利用日から（来店ごとに期限が延びる）</option>
              <option value="since_issue">カード発行日から固定（来店しても延びない）</option>
            </select>
          </Field>
          {form.card_expiry_mode === 'since_last_stamp' ? (
            <Field label="カードの有効期限（最終利用日からの月数。空欄=無期限）">
              <input
                type="number"
                min={1}
                value={form.card_expiry_months ?? ''}
                onChange={(e) => set('card_expiry_months', e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 3"
              />
            </Field>
          ) : (
            <Field label="カードの有効期限（発行日からの日数。空欄=無期限）">
              <input
                type="number"
                min={1}
                value={form.card_expiry_days_from_issue ?? ''}
                onChange={(e) => set('card_expiry_days_from_issue', e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 90"
              />
            </Field>
          )}
          <Field label="クーポンの既定有効期限（日数）">
            <input
              type="number"
              min={1}
              value={form.default_coupon_validity_days}
              onChange={(e) => set('default_coupon_validity_days', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </Field>
          <Field label="期限前リマインドを送るタイミング（残り○日）">
            <input
              type="number"
              min={1}
              value={form.reminder_days_before}
              onChange={(e) => set('reminder_days_before', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </Field>
          <Field label="セルフ延長機能（期限間近に「1回限定で1週間延長」をお客様自身に許可する）">
            <select
              value={form.card_expiry_self_extension_enabled ? '1' : '0'}
              onChange={(e) => set('card_expiry_self_extension_enabled', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="1">ON（既定）</option>
              <option value="0">OFF</option>
            </select>
          </Field>
          <Field label="完全に期限切れになった場合の扱い">
            <select
              value={form.card_expiry_penalty_type}
              onChange={(e) => set('card_expiry_penalty_type', e.target.value as CardSettings['card_expiry_penalty_type'])}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="none">このまま（スタンプ数・ランクをそのまま維持）</option>
              <option value="reset_to_start">一番初めから（スタンプ0・最初のランクに戻す）</option>
              <option value="drop_one_level">ランクを1段だけ下げる（スタンプは0に戻す）</option>
              {!!form.rank_enabled && <option value="drop_to_rank">指定したランクまで下げる（スタンプは0に戻す）</option>}
              <option value="reissue">カードを再発行扱いにする（発行日もリセットし、新規カードと同様に扱う）</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              いずれの場合も、ペナルティは「次回来店してスタッフがスタンプを押した瞬間」に適用されます（来店していない間に遡って変わることはありません）。
            </p>
          </Field>
          {form.card_expiry_penalty_type === 'drop_to_rank' && (
            <Field label="下げ先のランク">
              <select
                value={form.card_expiry_penalty_target_rank_id ?? ''}
                onChange={(e) => set('card_expiry_penalty_target_rank_id', e.target.value || null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">選択してください</option>
                {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          )}
        </Section>

        <Section title="予約導線">
          <Field label="「予約する」ボタンの遷移先URL（外部予約システム等。未設定ならLIFF内に留まります）">
            <input
              type="url"
              value={form.reservation_url ?? ''}
              onChange={(e) => set('reservation_url', e.target.value || null)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="https://tabelog.com/..."
            />
          </Field>
        </Section>

        <Section title="天候連携（ポイント倍率ルールの自動ON/OFF）">
          <p className="text-xs text-gray-500">
            住所を入力すると自動で位置情報を取得し、「天候」条件のポイント倍率ルールが現在の天気に応じて自動でON/OFFされます。未設定の場合は手動スイッチのみで動作します。
          </p>
          <Field label="店舗の住所">
            <div className="flex gap-2">
              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 長野県上田市天神1-6-2"
              />
              <button
                onClick={geocodeAddress}
                disabled={geocoding || !addressInput}
                className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
              >
                {geocoding ? '取得中...' : '位置情報を取得'}
              </button>
            </div>
            {geocodeMessage && <p className="text-xs text-gray-500 mt-1.5">{geocodeMessage}</p>}
            {form.shop_latitude != null && (
              <p className="text-xs text-emerald-700 mt-1.5">
                設定済み: 緯度{form.shop_latitude} / 経度{form.shop_longitude}
              </p>
            )}
          </Field>
          <Field label="天気を確認する間隔（分）">
            <input
              type="number"
              min={5}
              value={form.weather_check_interval_minutes}
              onChange={(e) => set('weather_check_interval_minutes', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">例: 60 = 1時間ごと、360 = 6時間ごと、1440 = 1日ごと</p>
          </Field>
          <Field label="基準時刻">
            <input
              type="time"
              value={form.weather_check_anchor_time}
              onChange={(e) => set('weather_check_anchor_time', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              チェックのタイミングはこの時刻を起点に区切られます。例: 間隔1440分（1日ごと）+ 基準時刻06:00 → 毎日6:00を過ぎたタイミングで1回チェック。間隔60分（1時間ごと）なら毎時この時刻の分から区切られます（既定00:00 = 0分/正時ごと）。
            </p>
          </Field>
        </Section>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
          {saved && <span className="text-sm text-emerald-700">保存しました</span>}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
