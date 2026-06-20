'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api, type ExpiredCouponHolder } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

export default function CouponRescuePage() {
  const { selectedAccount, loading: accountLoading } = useAccount()
  const [items, setItems] = useState<ExpiredCouponHolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [extendDays, setExtendDays] = useState(30)
  const [rescuingId, setRescuingId] = useState<string | null>(null)
  const [rescuedIds, setRescuedIds] = useState<Set<string>>(new Set())

  async function load() {
    if (!selectedAccount) return
    setLoading(true)
    setError('')
    const res = await api.couponRescue.listExpired(selectedAccount.id)
    if (res.success) setItems(res.data)
    else setError(res.error)
    setLoading(false)
  }

  useEffect(() => { load() }, [selectedAccount]) // eslint-disable-line react-hooks/exhaustive-deps

  async function rescue(item: ExpiredCouponHolder) {
    if (!selectedAccount) return
    if (!confirm(`${item.display_name ?? 'このお客様'}の「${item.coupon_name}」を本日から${extendDays}日間復活させ、LINEで通知します。よろしいですか？`)) return
    setRescuingId(item.id)
    try {
      const res = await api.couponRescue.rescue(item.id, selectedAccount.id, extendDays)
      if (res.success) {
        setRescuedIds((s) => new Set(s).add(item.id))
      } else {
        setError(res.error)
      }
    } finally {
      setRescuingId(null)
    }
  }

  if (accountLoading || (loading && selectedAccount)) {
    return <div><Header title="クーポン救済" /><div className="p-6 text-sm text-gray-500">読み込み中...</div></div>
  }
  if (!selectedAccount) {
    return <div><Header title="クーポン救済" /><div className="p-6 text-sm text-gray-500">LINEアカウントを選択してください</div></div>
  }

  return (
    <div>
      <Header title="クーポン救済" description="期限切れクーポンを保持している顧客を検索し、手動で復活させてLINEメッセージを送ります。何度でも実行できます（1回限定のセルフ延長とは別枠です）。" />
      <div className="p-6 max-w-3xl space-y-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">救済時の延長日数:</label>
          <input
            type="number"
            min={1}
            value={extendDays}
            onChange={(e) => setExtendDays(Number(e.target.value))}
            className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <span className="text-sm text-gray-500">日間（本日から）</span>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2">お客様</th>
                <th className="text-left px-4 py-2">クーポン</th>
                <th className="text-left px-4 py-2">期限切れ日</th>
                <th className="text-left px-4 py-2">過去の救済回数</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">期限切れクーポン保持者はいません</td></tr>
              )}
              {items.map((item) => (
                <tr key={item.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{item.display_name ?? '(表示名なし)'}</td>
                  <td className="px-4 py-2">{item.coupon_name}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(item.expires_at).toLocaleDateString('ja-JP')}</td>
                  <td className="px-4 py-2 text-gray-500">{item.rescue_count}回</td>
                  <td className="px-4 py-2 text-right">
                    {rescuedIds.has(item.id) ? (
                      <span className="text-xs text-emerald-700">救済済み✓</span>
                    ) : (
                      <button
                        onClick={() => rescue(item)}
                        disabled={rescuingId === item.id}
                        className="text-xs rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {rescuingId === item.id ? '処理中...' : '復活させる'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
