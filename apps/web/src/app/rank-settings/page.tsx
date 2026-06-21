'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import ImageUploader from '@/components/shared/image-uploader'
import { api, type CardRank, type CardRankMilestone, type CouponTemplate } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

interface EditForm {
  name: string
  maxStamps: number
  rewardCouponTemplateId: string
  imageUrl: string | null
}

function RankMilestonesSection({ rank, templates }: { rank: CardRank; templates: CouponTemplate[] }) {
  const [milestones, setMilestones] = useState<CardRankMilestone[]>([])
  const [loading, setLoading] = useState(true)
  const [threshold, setThreshold] = useState(Math.ceil(rank.max_stamps / 2))
  const [couponTemplateId, setCouponTemplateId] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const res = await api.cardRankMilestones.list(rank.id)
    if (res.success) setMilestones(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [rank.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!couponTemplateId || !threshold) return
    setBusy(true)
    try {
      const res = await api.cardRankMilestones.create({ cardRankId: rank.id, stampThreshold: threshold, couponTemplateId })
      if (res.success) {
        setCouponTemplateId('')
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await api.cardRankMilestones.delete(id)
    setMilestones((ms) => ms.filter((m) => m.id !== id))
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="text-xs font-medium text-gray-600 mb-2">中間報酬（例: {rank.max_stamps}個中5個でクーポン）</div>
      {loading ? (
        <div className="text-xs text-gray-400">読み込み中...</div>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {milestones.length === 0 && <li className="text-xs text-gray-400">まだ設定されていません</li>}
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-md px-2.5 py-1.5">
              <span>{m.stamp_threshold}個達成 → {templates.find((t) => t.id === m.coupon_template_id)?.name ?? '(不明なクーポン)'}</span>
              <button onClick={() => remove(m.id)} className="text-rose-600 underline ml-2 shrink-0">削除</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 items-end">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">何個目で</label>
          <input
            type="number"
            min={1}
            max={rank.max_stamps}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-16 border border-gray-300 rounded px-2 py-1 text-xs"
          />
        </div>
        <div className="flex-1">
          <label className="block text-[11px] text-gray-500 mb-0.5">クーポン</label>
          <select value={couponTemplateId} onChange={(e) => setCouponTemplateId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 text-xs">
            <option value="">選択してください</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button onClick={add} disabled={busy || !couponTemplateId} className="text-xs rounded-md bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-50 shrink-0">
          追加
        </button>
      </div>
    </div>
  )
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
  const [newImageUrl, setNewImageUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', maxStamps: 1, rewardCouponTemplateId: '', imageUrl: null })

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
        imageUrl: newImageUrl,
      })
      if (res.success) {
        setNewName('')
        setNewMax(5)
        setNewReward('')
        setNewImageUrl(null)
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
      imageUrl: rank.image_url,
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
        imageUrl: editForm.imageUrl,
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
      <Header title="ランク管理" description="ブロンズ/シルバー…の各ランクのゴール数・画像・クリア報酬クーポン・中間報酬を設定します。↑↓で表示順を変更できます。ON/OFF自体はスタンプカード設定で切り替えます。" />
      <div className="p-6 max-w-3xl space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        {ranks.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">まだランクがありません</div>
        )}

        {ranks.map((rank, index) => (
          <div key={rank.id} className="bg-white border border-gray-200 rounded-xl p-4">
            {editingId === rank.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">ランク名</label>
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">ゴール数</label>
                    <input type="number" min={1} value={editForm.maxStamps} onChange={(e) => setEditForm({ ...editForm, maxStamps: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">クリア報酬クーポン</label>
                  <select value={editForm.rewardCouponTemplateId} onChange={(e) => setEditForm({ ...editForm, rewardCouponTemplateId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">（なし）</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <ImageUploader
                  mode="url"
                  value={editForm.imageUrl ? { mode: 'url', url: editForm.imageUrl } : null}
                  onChange={(v) => setEditForm({ ...editForm, imageUrl: v?.mode === 'url' ? v.url : null })}
                  label="ランク画像（スタンプカード設定の「ランクバッジの見せ方」に応じて表示されます）"
                />
                <div className="flex gap-3">
                  <button onClick={saveEdit} disabled={busy} className="text-xs rounded-md bg-emerald-600 px-3 py-1.5 text-white">保存</button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 underline">キャンセル</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <button onClick={() => move(index, -1)} disabled={index === 0} className="text-gray-400 disabled:opacity-30" aria-label="上へ">▲</button>
                  <button onClick={() => move(index, 1)} disabled={index === ranks.length - 1} className="text-gray-400 disabled:opacity-30" aria-label="下へ">▼</button>
                </div>
                {rank.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={rank.image_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm text-gray-900">{rank.name}<span className="text-gray-400 text-xs ml-2">{rank.max_stamps}個でクリア</span></div>
                    <div className="shrink-0">
                      <button onClick={() => startEdit(rank)} className="text-xs text-gray-700 underline mr-3">編集</button>
                      <button onClick={() => deleteRank(rank.id)} className="text-xs text-rose-600 underline">削除</button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">クリア報酬: {templates.find((t) => t.id === rank.reward_coupon_template_id)?.name ?? '（なし）'}</div>
                  <RankMilestonesSection rank={rank} templates={templates} />
                </div>
              </div>
            )}
          </div>
        ))}

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
          <ImageUploader
            mode="url"
            value={newImageUrl ? { mode: 'url', url: newImageUrl } : null}
            onChange={(v) => setNewImageUrl(v?.mode === 'url' ? v.url : null)}
            label="ランク画像（任意・後からでも設定できます）"
          />
          <p className="text-xs text-gray-400">追加したランクは末尾に並びます。順番は↑↓ボタンで後から変更できます。中間報酬は追加後に各ランクのカードから設定できます。</p>
        </div>
      </div>
    </div>
  )
}
