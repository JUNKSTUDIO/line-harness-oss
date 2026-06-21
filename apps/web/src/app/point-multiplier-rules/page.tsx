'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api, type PointMultiplierRule, type CardSettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const COMBINATION_MODE_LABELS: Record<CardSettings['multiplier_combination_mode'], string> = {
  highest_priority_only: '優先度が最も高い1件のみ適用する',
  multiply_all: '同時にマッチした全ルールの倍率を掛け合わせる（例: 2倍 × 1.5倍 = 3倍）',
  sum_all: '同時にマッチした全ルールの倍率を足し合わせる（例: 2倍 + 1.5倍 = 3.5倍）',
}

const CONDITION_LABELS: Record<PointMultiplierRule['condition_type'], string> = {
  manual: '手動 (このスイッチがそのままON/OFF)',
  weather: '天候 (このスイッチがそのままON/OFF)',
  weekday: '毎週○曜日',
  day_of_month: '毎月○日',
  time_range: '特定時間帯',
  period: '特定期間',
}

function describeCondition(rule: PointMultiplierRule): string {
  switch (rule.condition_type) {
    case 'manual': return '手動スイッチ'
    case 'weather': return `天候連動 (${rule.weather_condition === 'rain' ? '雨' : rule.weather_condition === 'snow' ? '雪' : '-'})`
    case 'weekday': return `毎週${WEEKDAY_LABELS[rule.weekday ?? 0]}曜日`
    case 'day_of_month': return `毎月${rule.day_of_month ?? '?'}日`
    case 'time_range': return `${rule.time_start ?? '--:--'} 〜 ${rule.time_end ?? '--:--'}`
    case 'period': return `${rule.starts_at ?? '?'} 〜 ${rule.ends_at ?? '?'}`
  }
}

interface RuleForm {
  name: string
  multiplier: number
  conditionType: PointMultiplierRule['condition_type']
  weekday: number
  dayOfMonth: number
  timeStart: string
  timeEnd: string
  startsAt: string
  endsAt: string
  weatherCondition: NonNullable<PointMultiplierRule['weather_condition']>
}

const EMPTY_FORM: RuleForm = {
  name: '',
  multiplier: 2,
  conditionType: 'manual',
  weekday: 0,
  dayOfMonth: 1,
  timeStart: '15:00',
  timeEnd: '17:00',
  startsAt: '',
  endsAt: '',
  weatherCondition: 'rain',
}

function ruleToForm(rule: PointMultiplierRule): RuleForm {
  return {
    name: rule.name,
    multiplier: rule.multiplier,
    conditionType: rule.condition_type,
    weekday: rule.weekday ?? 0,
    dayOfMonth: rule.day_of_month ?? 1,
    timeStart: rule.time_start ?? '15:00',
    timeEnd: rule.time_end ?? '17:00',
    startsAt: rule.starts_at ?? '',
    endsAt: rule.ends_at ?? '',
    weatherCondition: rule.weather_condition ?? 'rain',
  }
}

function RuleFields({ form, setForm }: { form: RuleForm; setForm: (f: RuleForm) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-600 mb-1">ルール名</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例: 雨の日2倍" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">倍率</label>
        <input type="number" step={0.5} min={0.5} value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="col-span-2">
        <label className="block text-xs text-gray-600 mb-1">条件タイプ</label>
        <select value={form.conditionType} onChange={(e) => setForm({ ...form, conditionType: e.target.value as PointMultiplierRule['condition_type'] })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
          {Object.entries(CONDITION_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      {form.conditionType === 'weather' && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">天候</label>
          <select value={form.weatherCondition} onChange={(e) => setForm({ ...form, weatherCondition: e.target.value as 'rain' | 'snow' })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="rain">雨</option>
            <option value="snow">雪</option>
          </select>
        </div>
      )}
      {form.conditionType === 'weekday' && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">曜日</label>
          <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            {WEEKDAY_LABELS.map((label, i) => <option key={i} value={i}>{label}曜日</option>)}
          </select>
        </div>
      )}
      {form.conditionType === 'day_of_month' && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">何日</label>
          <input
            type="number"
            min={1}
            max={31}
            value={form.dayOfMonth}
            onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">31日等、その月に存在しない日を指定した月は適用されません。</p>
        </div>
      )}
      {form.conditionType === 'time_range' && (
        <>
          <div>
            <label className="block text-xs text-gray-600 mb-1">開始時刻</label>
            <input type="time" value={form.timeStart} onChange={(e) => setForm({ ...form, timeStart: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">終了時刻</label>
            <input type="time" value={form.timeEnd} onChange={(e) => setForm({ ...form, timeEnd: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </>
      )}
      {form.conditionType === 'period' && (
        <>
          <div>
            <label className="block text-xs text-gray-600 mb-1">開始日</label>
            <input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">終了日</label>
            <input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </>
      )}
    </div>
  )
}

function buildPayload(form: RuleForm) {
  return {
    name: form.name,
    multiplier: form.multiplier,
    conditionType: form.conditionType,
    weekday: form.conditionType === 'weekday' ? form.weekday : null,
    dayOfMonth: form.conditionType === 'day_of_month' ? form.dayOfMonth : null,
    timeStart: form.conditionType === 'time_range' ? form.timeStart : null,
    timeEnd: form.conditionType === 'time_range' ? form.timeEnd : null,
    startsAt: form.conditionType === 'period' ? form.startsAt : null,
    endsAt: form.conditionType === 'period' ? form.endsAt : null,
    weatherCondition: form.conditionType === 'weather' ? form.weatherCondition : null,
  }
}

export default function PointMultiplierRulesPage() {
  const { selectedAccount, loading: accountLoading } = useAccount()
  const [rules, setRules] = useState<PointMultiplierRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<RuleForm>(EMPTY_FORM)
  const [combinationMode, setCombinationMode] = useState<CardSettings['multiplier_combination_mode']>('highest_priority_only')
  const [savingMode, setSavingMode] = useState(false)

  async function load() {
    if (!selectedAccount) return
    setLoading(true)
    const [rulesRes, settingsRes] = await Promise.all([
      api.pointMultiplierRules.list(selectedAccount.id),
      api.cardSettings.get(selectedAccount.id),
    ])
    if (rulesRes.success) setRules(rulesRes.data)
    else setError(rulesRes.error)
    if (settingsRes.success) setCombinationMode(settingsRes.data.multiplier_combination_mode)
    setLoading(false)
  }

  useEffect(() => { load() }, [selectedAccount]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCombinationMode(mode: CardSettings['multiplier_combination_mode']) {
    if (!selectedAccount) return
    setCombinationMode(mode)
    setSavingMode(true)
    try {
      await api.cardSettings.update(selectedAccount.id, { multiplier_combination_mode: mode })
    } finally {
      setSavingMode(false)
    }
  }

  async function toggle(rule: PointMultiplierRule) {
    const res = await api.pointMultiplierRules.toggle(rule.id, rule.is_active === 0)
    if (res.success) setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, is_active: rule.is_active === 0 ? 1 : 0 } : r)))
  }

  async function remove(id: string) {
    if (!confirm('このルールを削除しますか？')) return
    await api.pointMultiplierRules.delete(id)
    setRules((rs) => rs.filter((r) => r.id !== id))
  }

  async function move(index: number, direction: -1 | 1) {
    if (!selectedAccount) return
    const target = index + direction
    if (target < 0 || target >= rules.length) return
    const reordered = [...rules]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    setRules(reordered) // 楽観的更新
    const res = await api.pointMultiplierRules.reorder(selectedAccount.id, reordered.map((r) => r.id))
    if (res.success) setRules(res.data)
    else await load() // 失敗時は読み直して整合性を保つ
  }

  async function add() {
    if (!selectedAccount || !form.name) return
    setBusy(true)
    setError('')
    try {
      const res = await api.pointMultiplierRules.create({ accountId: selectedAccount.id, ...buildPayload(form) })
      if (res.success) {
        setForm(EMPTY_FORM)
        await load()
      } else {
        setError(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  function startEdit(rule: PointMultiplierRule) {
    setEditingId(rule.id)
    setEditForm(ruleToForm(rule))
  }

  async function saveEdit() {
    if (!editingId) return
    setBusy(true)
    setError('')
    try {
      const res = await api.pointMultiplierRules.update(editingId, buildPayload(editForm))
      if (res.success) {
        setRules((rs) => rs.map((r) => (r.id === editingId ? res.data : r)))
        setEditingId(null)
      } else {
        setError(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  if (accountLoading || (loading && selectedAccount)) {
    return <div><Header title="ポイント倍率ルール" /><div className="p-6 text-sm text-gray-500">読み込み中...</div></div>
  }
  if (!selectedAccount) {
    return <div><Header title="ポイント倍率ルール" /><div className="p-6 text-sm text-gray-500">LINEアカウントを選択してください</div></div>
  }

  return (
    <div>
      <Header title="ポイント倍率ルール" description="雨の日2倍・ハッピーアワーなど、条件付きでスタンプ付与数を倍率するルールを管理します。複数同時にマッチした場合の扱いは下の「複数ルールの合算方式」で設定します。" />
      <div className="p-6 max-w-3xl space-y-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-bold text-gray-900">複数ルールの合算方式</h2>
          <p className="text-xs text-gray-500">同じ瞬間に複数のルールがマッチした場合 (例: 雨の日でかつテスト期間中) の計算方法です。</p>
          <select
            value={combinationMode}
            onChange={(e) => saveCombinationMode(e.target.value as CardSettings['multiplier_combination_mode'])}
            disabled={savingMode}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {Object.entries(COMBINATION_MODE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          {rules.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">まだルールがありません</div>
          )}
          {rules.length > 1 && (
            <p className="text-xs text-gray-400">「優先度が最も高い1件のみ適用する」を選んだ場合、↑↓で動かした一番上のルールが最優先になります。</p>
          )}
          {rules.map((rule, index) => (
            <div key={rule.id} className="bg-white border border-gray-200 rounded-xl p-4">
              {editingId === rule.id ? (
                <div className="space-y-3">
                  <RuleFields form={editForm} setForm={setEditForm} />
                  <div className="flex gap-3">
                    <button onClick={saveEdit} disabled={busy} className="text-xs rounded-md bg-emerald-600 px-3 py-1.5 text-white">保存</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 underline">キャンセル</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center gap-1 text-gray-400 shrink-0">
                    <button onClick={() => move(index, -1)} disabled={index === 0} className="disabled:opacity-30" aria-label="上へ">▲</button>
                    <button onClick={() => move(index, 1)} disabled={index === rules.length - 1} className="disabled:opacity-30" aria-label="下へ">▼</button>
                  </div>
                  <button
                    onClick={() => toggle(rule)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${rule.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    aria-label="ON/OFF"
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rule.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{rule.name}</div>
                    <div className="text-xs text-gray-500">{CONDITION_LABELS[rule.condition_type]} · {describeCondition(rule)}</div>
                  </div>
                  <div className="text-lg font-bold text-emerald-700">×{rule.multiplier}</div>
                  <button onClick={() => startEdit(rule)} className="text-xs text-gray-700 underline">編集</button>
                  <button onClick={() => remove(rule.id)} className="text-xs text-rose-600 underline">削除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-900">ルールを追加</h2>
          <RuleFields form={form} setForm={setForm} />
          <button onClick={add} disabled={busy || !form.name} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            追加
          </button>
        </div>
      </div>
    </div>
  )
}
