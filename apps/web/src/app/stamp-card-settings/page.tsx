'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import ImageUploader from '@/components/shared/image-uploader'
import { api, type CardSettings, type CardRank, type CouponTemplate } from '@/lib/api'
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
  reminder_reservation_button_label: null,
  reminder_reservation_helper_text: null,
  reminder_extend_button_label: null,
  reservation_url: null,
  stamp_image_url: null,
  shop_latitude: null,
  shop_longitude: null,
  shop_address: null,
  weather_check_interval_minutes: 30,
  weather_check_anchor_time: '00:00',
  rank_badge_layout: 'split',
  remote_grant_min_role: 'owner',
  friend_add_coupon_template_id: null,
  calendar_ical_url: null,
  calendar_months_ahead: 3,
  calendar_show_coupon_expiry: 0,
  calendar_show_card_expiry: 0,
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
  const [couponTemplates, setCouponTemplates] = useState<CouponTemplate[]>([])

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true)
    setError('')
    Promise.all([
      api.cardSettings.get(selectedAccount.id),
      api.cardRanks.list(selectedAccount.id),
      api.couponTemplates.list(selectedAccount.id),
    ]).then(([settingsRes, ranksRes, templatesRes]) => {
      if (settingsRes.success) {
        setForm(settingsRes.data)
        setAddressInput(settingsRes.data.shop_address ?? '')
      } else {
        setError(settingsRes.error)
      }
      if (ranksRes.success) setRanks(ranksRes.data)
      if (templatesRes.success) setCouponTemplates(templatesRes.data.filter((t) => t.is_active))
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
        reminder_reservation_button_label: form.reminder_reservation_button_label,
        reminder_reservation_helper_text: form.reminder_reservation_helper_text,
        reminder_extend_button_label: form.reminder_extend_button_label,
        reservation_url: form.reservation_url,
        stamp_image_url: form.stamp_image_url,
        weather_check_interval_minutes: form.weather_check_interval_minutes,
        weather_check_anchor_time: form.weather_check_anchor_time,
        rank_badge_layout: form.rank_badge_layout,
        remote_grant_min_role: form.remote_grant_min_role,
        friend_add_coupon_template_id: form.friend_add_coupon_template_id,
        calendar_ical_url: form.calendar_ical_url,
        calendar_months_ahead: form.calendar_months_ahead,
        calendar_show_coupon_expiry: form.calendar_show_coupon_expiry,
        calendar_show_card_expiry: form.calendar_show_card_expiry,
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

        <CustomerFacingUrls liffId={selectedAccount.liffId ?? null} />

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

        <Section title="友だち追加時クーポン">
          <Field label="友だち追加時に発行するクーポン（既定）">
            <select
              value={form.friend_add_coupon_template_id ?? ''}
              onChange={(e) => set('friend_add_coupon_template_id', e.target.value || null)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">発行しない（既定）</option>
              {couponTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              友だち追加（LINEの「追加」操作）のたびにこのクーポンを発行します。「リファラルリンク」側で個別にクーポンを設定したリンク経由の場合は、そちらが優先されます（両方同時に発行されることはありません）。
            </p>
          </Field>
        </Section>

        <Section title="営業日カレンダー">
          <Field label="iCal URL（任意）">
            <input
              type="url"
              value={form.calendar_ical_url ?? ''}
              onChange={(e) => set('calendar_ical_url', e.target.value || null)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              GoogleカレンダーなどのiCal形式の公開URLを指定すると、その予定がお客様向けの「営業日カレンダー」に表示されます。
            </p>
          </Field>
          <Field label="何ヶ月先まで表示するか">
            <input
              type="number"
              min={1}
              max={12}
              value={form.calendar_months_ahead}
              onChange={(e) => set('calendar_months_ahead', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </Field>
          <Field label="クーポンの有効期限をカレンダーに表示する">
            <select
              value={form.calendar_show_coupon_expiry ? '1' : '0'}
              onChange={(e) => set('calendar_show_coupon_expiry', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="0">OFF</option>
              <option value="1">ON</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              ONにすると、お客様が保有しているクーポンの有効期限日にカレンダー上で印が表示され、タップするとどのクーポンが切れるか確認できます。
            </p>
          </Field>
          <Field label="ショップカードの有効期限をカレンダーに表示する">
            <select
              value={form.calendar_show_card_expiry ? '1' : '0'}
              onChange={(e) => set('calendar_show_card_expiry', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="0">OFF</option>
              <option value="1">ON</option>
            </select>
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
          <Field label="予約ボタンの上に表示する文章（空欄で既定文言）">
            <input
              type="text"
              value={form.reminder_reservation_helper_text ?? ''}
              onChange={(e) => set('reminder_reservation_helper_text', e.target.value || null)}
              placeholder="お席の確保はこちらからどうぞ。"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </Field>
          <Field label="予約ボタンの文言（空欄で既定文言）">
            <input
              type="text"
              value={form.reminder_reservation_button_label ?? ''}
              onChange={(e) => set('reminder_reservation_button_label', e.target.value || null)}
              placeholder="予約する"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </Field>
          <Field label="延長ボタンの文言（空欄で既定文言）">
            <input
              type="text"
              value={form.reminder_extend_button_label ?? ''}
              onChange={(e) => set('reminder_extend_button_label', e.target.value || null)}
              placeholder="どうしても来店できない方はこちら（1回限定で1週間延長）"
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

        <Section title="リモート操作の権限">
          <Field label="「利用履歴」画面からの遠隔ポイント付与・クーポン発行を許可する最低権限">
            <select
              value={form.remote_grant_min_role}
              onChange={(e) => set('remote_grant_min_role', e.target.value as CardSettings['remote_grant_min_role'])}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="owner">オーナーのみ（最も安全）</option>
              <option value="admin">管理者以上（オーナー・管理者）</option>
              <option value="staff">スタッフ以上（全員）</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              QRコードを読まずに、管理画面の「利用履歴」からお客様を検索して直接ポイント付与・クーポン発行できる機能です。ここで選んだ権限以上のスタッフだけが実行できます。
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

// リッチメニューのURLアクションに貼る用の、お客様向けLIFF URL。通常だと組み立て方が
// 分かりにくいため、ここでそのまま読める・コピーできる形で出しておく。
function CustomerFacingUrls({ liffId }: { liffId: string | null }) {
  if (!liffId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700">
        LIFF IDが未設定のため、お客様向けURLを表示できません。「LINEアカウント」設定でLIFF IDを登録してください。
      </div>
    )
  }
  const base = `https://liff.line.me/${liffId}?page=stamp-card`
  return (
    <Section title="お客様向けURL（リッチメニューのURLアクションに使えます）">
      <CustomerUrlRow label="スタンプカードを表示するURL" url={base} />
      <CustomerUrlRow label="営業日カレンダーを表示するURL" url={`${base}&action=calendar`} />
    </Section>
  )
}

function CustomerUrlRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // クリップボードAPIが使えない場合は表示されているテキストを手動選択してもらう
    }
  }
  return (
    <div>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="flex items-stretch gap-1 mt-1">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs font-mono bg-gray-50 text-gray-700 truncate"
        />
        <button
          type="button"
          onClick={onCopy}
          className="px-3 rounded text-xs font-medium border border-gray-200 hover:bg-gray-50 whitespace-nowrap"
        >
          {copied ? '✓ コピー済' : 'コピー'}
        </button>
      </div>
    </div>
  )
}
