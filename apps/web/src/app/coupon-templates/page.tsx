'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api, type CouponTemplate } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const EMPTY_FORM = {
  name: '',
  description: '',
  validityType: 'relative_days' as CouponTemplate['validity_type'],
  validityDays: 30,
  absoluteExpiresAt: '',
}

type EditForm = typeof EMPTY_FORM

export default function CouponTemplatesPage() {
  const { selectedAccount, loading: accountLoading } = useAccount()
  const [templates, setTemplates] = useState<CouponTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_FORM)

  async function load() {
    if (!selectedAccount) return
    setLoading(true)
    const res = await api.couponTemplates.list(selectedAccount.id)
    if (res.success) setTemplates(res.data)
    else setError(res.error)
    setLoading(false)
  }

  useEffect(() => { load() }, [selectedAccount]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!selectedAccount || !form.name) return
    setBusy(true)
    setError('')
    try {
      const res = await api.couponTemplates.create({
        accountId: selectedAccount.id,
        name: form.name,
        description: form.description || null,
        validityType: form.validityType,
        validityDays: form.validityType === 'relative_days' ? form.validityDays : undefined,
        absoluteExpiresAt: form.validityType === 'absolute_date' ? form.absoluteExpiresAt : undefined,
      })
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

  function startEdit(t: CouponTemplate) {
    setEditingId(t.id)
    setEditForm({
      name: t.name,
      description: t.description ?? '',
      validityType: t.validity_type,
      validityDays: t.validity_days ?? 30,
      absoluteExpiresAt: t.absolute_expires_at ?? '',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    setBusy(true)
    setError('')
    try {
      const res = await api.couponTemplates.update(editingId, {
        name: editForm.name,
        description: editForm.description || null,
        validityType: editForm.validityType,
        validityDays: editForm.validityType === 'relative_days' ? editForm.validityDays : null,
        absoluteExpiresAt: editForm.validityType === 'absolute_date' ? editForm.absoluteExpiresAt : null,
      })
      if (res.success) {
        setTemplates((ts) => ts.map((t) => (t.id === editingId ? res.data : t)))
        setEditingId(null)
      } else {
        setError(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(t: CouponTemplate) {
    if (!confirm(`「${t.name}」を削除しますか？`)) return
    const res = await api.couponTemplates.delete(t.id)
    if (res.success) {
      setTemplates((ts) => ts.filter((x) => x.id !== t.id))
      return
    }
    if (res.error === 'has_issued_coupons') {
      const deactivateInstead = confirm(
        'このテンプレートは既にお客様へ発行済みのクーポンがあるため削除できません（発行済みクーポンを巻き込んで消えてしまうのを防ぐためです）。\n\n代わりに「無効化」して、今後この内容での新規発行を停止しますか？',
      )
      if (deactivateInstead) {
        const updateRes = await api.couponTemplates.update(t.id, { isActive: false })
        if (updateRes.success) setTemplates((ts) => ts.map((x) => (x.id === t.id ? updateRes.data : x)))
      }
      return
    }
    setError(res.error)
  }

  if (accountLoading || (loading && selectedAccount)) {
    return <div><Header title="クーポンテンプレート" /><div className="p-6 text-sm text-gray-500">読み込み中...</div></div>
  }
  if (!selectedAccount) {
    return <div><Header title="クーポンテンプレート" /><div className="p-6 text-sm text-gray-500">LINEアカウントを選択してください</div></div>
  }

  return (
    <div>
      <Header title="クーポンテンプレート" description="ランク到達報酬や単独キャンペーンで発行するクーポンのマスタです。発行済みのクーポンは編集後も内容（名前等）が変わりません。" />
      <div className="p-6 max-w-3xl space-y-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="space-y-2">
          {templates.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">まだテンプレートがありません</div>
          )}
          {templates.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
              {editingId === t.id ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">クーポン名</label>
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">説明（任意）</label>
                    <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">有効期限の種類</label>
                      <select value={editForm.validityType} onChange={(e) => setEditForm({ ...editForm, validityType: e.target.value as CouponTemplate['validity_type'] })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="relative_days">発行から○日間</option>
                        <option value="absolute_date">絶対日付</option>
                      </select>
                    </div>
                    {editForm.validityType === 'relative_days' ? (
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">有効日数</label>
                        <input type="number" min={1} value={editForm.validityDays} onChange={(e) => setEditForm({ ...editForm, validityDays: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">期限日</label>
                        <input type="date" value={editForm.absoluteExpiresAt} onChange={(e) => setEditForm({ ...editForm, absoluteExpiresAt: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={saveEdit} disabled={busy} className="text-xs rounded-md bg-emerald-600 px-3 py-1.5 text-white">保存</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 underline">キャンセル</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">
                      {t.name}
                      {!t.is_active && <span className="ml-2 text-xs text-gray-400">（無効化済み）</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t.description}
                      {t.description && ' · '}
                      {t.validity_type === 'relative_days' ? `発行から${t.validity_days}日間有効` : `${t.absolute_expires_at}まで有効`}
                    </div>
                  </div>
                  <button onClick={() => startEdit(t)} className="text-xs text-gray-700 underline">編集</button>
                  <button onClick={() => remove(t)} className="text-xs text-rose-600 underline">削除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-900">テンプレートを追加</h2>
          <div>
            <label className="block text-xs text-gray-600 mb-1">クーポン名</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例: ドリンク1杯無料" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">説明（任意）</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">有効期限の種類</label>
              <select value={form.validityType} onChange={(e) => setForm({ ...form, validityType: e.target.value as CouponTemplate['validity_type'] })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="relative_days">発行から○日間</option>
                <option value="absolute_date">絶対日付</option>
              </select>
            </div>
            {form.validityType === 'relative_days' ? (
              <div>
                <label className="block text-xs text-gray-600 mb-1">有効日数</label>
                <input type="number" min={1} value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            ) : (
              <div>
                <label className="block text-xs text-gray-600 mb-1">期限日</label>
                <input type="date" value={form.absoluteExpiresAt} onChange={(e) => setForm({ ...form, absoluteExpiresAt: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
          </div>
          <button onClick={add} disabled={busy || !form.name} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            追加
          </button>
        </div>
      </div>
    </div>
  )
}
