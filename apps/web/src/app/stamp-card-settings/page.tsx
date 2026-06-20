'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import ImageUploader from '@/components/shared/image-uploader'
import { api, type CardSettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const EMPTY: CardSettings = {
  line_account_id: '',
  stamp_rule_type: 'per_visit',
  amount_per_stamp: null,
  signup_bonus_stamps: 0,
  rank_enabled: 0,
  flat_goal_stamps: 5,
  card_expiry_months: null,
  default_coupon_validity_days: 30,
  reminder_days_before: 3,
  reservation_url: null,
  stamp_image_url: null,
  shop_latitude: null,
  shop_longitude: null,
  shop_address: null,
  weather_check_interval_minutes: 30,
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

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true)
    setError('')
    api.cardSettings.get(selectedAccount.id).then((res) => {
      if (res.success) {
        setForm(res.data)
        setAddressInput(res.data.shop_address ?? '')
      } else {
        setError(res.error)
      }
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
        default_coupon_validity_days: form.default_coupon_validity_days,
        reminder_days_before: form.reminder_days_before,
        reservation_url: form.reservation_url,
        stamp_image_url: form.stamp_image_url,
        weather_check_interval_minutes: form.weather_check_interval_minutes,
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
            <p className="text-xs text-gray-500">
              ランクごとのゴール数・報酬クーポンの設定画面は未実装です。現時点ではDB直接操作が必要です。
            </p>
          )}
        </Section>

        <Section title="スタンプ画像">
          <ImageUploader
            mode="url"
            value={form.stamp_image_url ? { mode: 'url', url: form.stamp_image_url } : null}
            onChange={(v) => set('stamp_image_url', v?.mode === 'url' ? v.url : null)}
            label="スタンプが押されたマスに表示する画像（未設定なら「済」のテキストスタンプ）"
          />
        </Section>

        <Section title="有効期限 / リマインド">
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
