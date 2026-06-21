'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api, type CardRank, type CouponTemplate } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

interface EditForm {
  name: string
  maxStamps: number
  rewardCouponTemplateId: string
}

export default function RankSettingsPage() {
  const { selectedAccount, loading: accountLoading } = useAccount()
  const [ranks, setRanks] = useState<CardRank[]>([])
  const [templates, setTemplates] = useState<CouponTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newMax, setNewMax] = useState(5)
  const [newReward, setNewReward] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', maxStamps: 1, rewardCouponTemplateId: '' })

  async function load() {
    if (!selectedAccount) return
    setLoading(true)
    setError('')
    const [ranksRes, templatesRes] = await Promise.all([
      api.cardRanks.list(selectedAccount.id),
      api.couponTemplates.list(selectedAccount.id),
    ])
    if (ranksRes.success) setRanks(ranksRes.data)
    else setError(ranksRes.error)
    if (templatesRes.success) setTemplates(templatesRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [selectedAccount]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addRank() {
    if (!selectedAccount || !newName || !newMax) return
    setBusy(true)
    setError('')
    try {
      const res = await api.cardRanks.create({
        accountId: selectedAccount.id,
        name: newName,
        maxStamps: newMax,
        rewardCouponTemplateId: newReward || null,
      })
      if (res.success) {
        setNewName('')
        setNewMax(5)
        setNewReward('')
        await load()
      } else {
        setError(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  function startEdit(rank: CardRank) {
    setEditingId(rank.id)
    setEditForm({
      name: rank.name,
      maxStamps: rank.max_stamps,
      rewardCouponTemplateId: rank.reward_coupon_template_id ?? '',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    setBusy(true)
    setError('')
    try {
      const res = await api.cardRanks.update(editingId, {
        name: editForm.name,
        maxStamps: editForm.maxStamps,
        rewardCouponTemplateId: editForm.rewardCouponTemplateId || null,
      })
      if (res.success) {
        setRanks((rs) => rs.map((r) => (r.id === editingId ? res.data : r)))
        setEditingId(null)
      } else {
        setError(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  async function deleteRank(id: string) {
    if (!confirm('このランクを削除しますか？すでにこのランクのお客様がいる場合、ランク情報が外れます。')) return
    await api.cardRanks.delete(id)
    setRanks((rs) => rs.filter((r) => r.id !== id))
  }

  async function move(index: number, direction: -1 | 1) {
    if (!selectedAccount) return
    const target = index + direction
    if (target < 0 || target >= ranks.length) return
    const reordered = [...ranks]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    setRanks(reordered) // 楽観的更新
    const res = await api.cardRanks.reorder(selectedAccount.id, reordered.map((r) => r.id))
    if (res.success) setRanks(res.data)
    else await load() // 失敗時は読み直して整合性を保つ
  }

  if (accountLoading || (loading && selectedAccount)) {
    return <div><Header title="ランク管理" /><div className="p-6 text-sm text-gray-500">読み込み中...</div></div>
  }
  if (!selectedAccount) {
    return <div><Header title="ランク管理" /><div className="p-6 text-sm text-gray-500">LINEアカウントを選択してください</div></div>
  }

  return (
    <div>
      <Header title="ランク管理" description="ブロンズ/シルバー…の各ランクのゴール数とクリア報酬クーポンを設定します。↑↓で表示順を変更できます。ON/OFF自体はスタンプカード設定で切り替えます。" />
      <div className="p-6 max-w-3xl space-y-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2">順</th>
                <th className="text-left px-4 py-2">ランク名</th>
                <th className="text-left px-4 py-2">ゴール数</th>
                <th className="text-left px-4 py-2">クリア報酬クーポン</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {ranks.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">まだランクがありません</td></tr>
              )}
              {ranks.map((rank, index) => (
                <tr key={rank.id} className="border-t border-gray-100">
                  {editingId === rank.id ? (
                    <>
                      <td className="px-4 py-2 text-gray-400">{rank.rank_order}</td>
                      <td className="px-4 py-2">
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={1}
                          value={editForm.maxStamps}
                          onChange={(e) => setEditForm({ ...editForm, maxStamps: Number(e.target.value) })}
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editForm.rewardCouponTemplateId}
                          onChange={(e) => setEditForm({ ...editForm, rewardCouponTemplateId: e.target.value })}
                          className="border border-gray-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="">（なし）</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={saveEdit} disabled={busy} className="text-xs text-emerald-700 underline mr-3">保存</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 underline">キャンセル</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 text-gray-400">
                        <div className="flex items-center gap-1">
                          <button onClick={() => move(index, -1)} disabled={index === 0} className="disabled:opacity-30" aria-label="上へ">▲</button>
                          <button onClick={() => move(index, 1)} disabled={index === ranks.length - 1} className="disabled:opacity-30" aria-label="下へ">▼</button>
                        </div>
                      </td>
                      <td className="px-4 py-2">{rank.name}</td>
                      <td className="px-4 py-2">{rank.max_stamps}</td>
                      <td className="px-4 py-2">{templates.find((t) => t.id === rank.reward_coupon_template_id)?.name ?? '（なし）'}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={() => startEdit(rank)} className="text-xs text-gray-700 underline mr-3">編集</button>
                        <button onClick={() => deleteRank(rank.id)} className="text-xs text-rose-600 underline">削除</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-900">ランクを追加</h2>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs text-gray-600 mb-1">ランク名</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: ブロンズ" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">ゴール数</label>
              <input type="number" min={1} value={newMax} onChange={(e) => setNewMax(Number(e.target.value))} className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">クリア報酬クーポン</label>
              <select value={newReward} onChange={(e) => setNewReward(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">（なし）</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button onClick={addRank} disabled={busy || !newName} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              追加
            </button>
          </div>
          <p className="text-xs text-gray-400">追加したランクは末尾に並びます。順番は↑↓ボタンで後から変更できます。</p>
        </div>
      </div>
    </div>
  )
}
