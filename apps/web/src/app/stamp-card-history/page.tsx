'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api, type FriendListItem, type StampCardHistory, type CouponTemplate } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const COUPON_STATUS_LABEL: Record<StampCardHistory['coupons'][number]['status'], string> = {
  unused: '未使用', used: '使用済み', expired: '期限切れ',
}

const ROLE_LEVEL: Record<'owner' | 'admin' | 'staff', number> = { staff: 1, admin: 2, owner: 3 }

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function StampCardHistoryPage() {
  const { selectedAccount, loading: accountLoading } = useAccount()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<FriendListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FriendListItem | null>(null)
  const [history, setHistory] = useState<StampCardHistory | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState('')

  // 管理画面からの遠隔ポイント付与・クーポン発行。表示するかどうかは現在ログイン中の
  // スタッフのロールと、card_settings.remote_grant_min_role の比較で決める
  // (最終的な防御はAPI側の403。ここではUXのため事前に隠す)。
  const [canRemoteGrant, setCanRemoteGrant] = useState(false)
  const [couponTemplates, setCouponTemplates] = useState<CouponTemplate[]>([])
  const [grantPointsInput, setGrantPointsInput] = useState('1')
  const [granting, setGranting] = useState(false)
  const [selectedCouponTemplateId, setSelectedCouponTemplateId] = useState('')
  const [issuingCoupon, setIssuingCoupon] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    if (!selectedAccount) return
    Promise.all([api.staff.me(), api.cardSettings.get(selectedAccount.id), api.couponTemplates.list(selectedAccount.id)]).then(
      ([meRes, settingsRes, templatesRes]) => {
        if (meRes.success && settingsRes.success) {
          const role = meRes.data.role as 'owner' | 'admin' | 'staff'
          setCanRemoteGrant(ROLE_LEVEL[role] >= ROLE_LEVEL[settingsRes.data.remote_grant_min_role])
        }
        if (templatesRes.success) setCouponTemplates(templatesRes.data.filter((t) => t.is_active))
      },
    )
  }, [selectedAccount])

  async function doSearch() {
    if (!selectedAccount || !search) return
    setSearching(true)
    setError('')
    try {
      const res = await api.friends.list({ accountId: selectedAccount.id, search, limit: 20 })
      if (res.success) setResults(res.data.items)
      else setError(res.error)
    } finally {
      setSearching(false)
    }
  }

  async function selectFriend(friend: FriendListItem) {
    if (!selectedAccount) return
    setSelected(friend)
    setHistory(null)
    setActionMessage('')
    setLoadingHistory(true)
    setError('')
    try {
      const res = await api.stampCardHistory.get(friend.id, selectedAccount.id)
      if (res.success) setHistory(res.data)
      else setError(res.error)
    } finally {
      setLoadingHistory(false)
    }
  }

  async function refreshHistory() {
    if (!selectedAccount || !selected) return
    const res = await api.stampCardHistory.get(selected.id, selectedAccount.id)
    if (res.success) setHistory(res.data)
  }

  async function doGrantPoints() {
    if (!selectedAccount || !selected) return
    const points = Number(grantPointsInput)
    if (!Number.isFinite(points) || points <= 0) return
    setGranting(true)
    setActionMessage('')
    setError('')
    try {
      const res = await api.stampCardHistory.grantPoints(selected.id, selectedAccount.id, points)
      if (res.success) {
        setActionMessage(`${points}pt 付与しました（現在 ${res.data.stampCount}pt）${res.data.issuedCoupon ? ' ・ ランク到達クーポンを発行しました' : ''}${res.data.milestoneCouponNames.length > 0 ? ` ・ ${res.data.milestoneCouponNames.join('、')}を発行しました` : ''}`)
        await refreshHistory()
      } else {
        setError(res.error)
      }
    } finally {
      setGranting(false)
    }
  }

  async function doIssueCoupon() {
    if (!selectedAccount || !selected || !selectedCouponTemplateId) return
    setIssuingCoupon(true)
    setActionMessage('')
    setError('')
    try {
      const res = await api.stampCardHistory.issueCoupon(selected.id, selectedAccount.id, selectedCouponTemplateId)
      if (res.success) {
        const name = couponTemplates.find((t) => t.id === selectedCouponTemplateId)?.name ?? 'クーポン'
        setActionMessage(`「${name}」を発行しました`)
        setSelectedCouponTemplateId('')
        await refreshHistory()
      } else {
        setError(res.error)
      }
    } finally {
      setIssuingCoupon(false)
    }
  }

  if (accountLoading) {
    return <div><Header title="利用履歴" /><div className="p-6 text-sm text-gray-500">読み込み中...</div></div>
  }
  if (!selectedAccount) {
    return <div><Header title="利用履歴" /><div className="p-6 text-sm text-gray-500">LINEアカウントを選択してください</div></div>
  }

  return (
    <div>
      <Header title="利用履歴" description="お客様を検索して、スタンプ付与履歴とクーポンの発行/利用履歴を確認します。" />
      <div className="p-6 max-w-3xl space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
            placeholder="表示名で検索"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={doSearch} disabled={searching || !search} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            検索
          </button>
        </div>

        {results.length > 0 && !selected && (
          <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {results.map((friend) => (
              <li key={friend.id}>
                <button onClick={() => selectFriend(friend)} className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-3">
                  {friend.pictureUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={friend.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                  )}
                  <span>{friend.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {selected.pictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.pictureUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                )}
                <div className="font-medium text-sm text-gray-900">{selected.displayName}</div>
              </div>
              <button onClick={() => { setSelected(null); setHistory(null) }} className="text-xs text-gray-500 underline">
                検索に戻る
              </button>
            </div>

            {loadingHistory ? (
              <div className="text-sm text-gray-500">読み込み中...</div>
            ) : history ? (
              <>
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  {history.card ? (
                    <div className="text-sm text-gray-900">
                      現在 {history.card.stampCount}pt（累計 {history.card.totalStampCount}pt）
                      {history.card.status === 'expired' && <span className="ml-2 text-xs text-rose-600">期限切れ</span>}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400">スタンプカードはまだ発行されていません</div>
                  )}
                </div>

                {actionMessage && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-lg text-sm">{actionMessage}</div>
                )}

                {canRemoteGrant && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                    <h2 className="text-sm font-bold text-gray-900">遠隔付与（QRコード読み取り不要）</h2>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">ポイントを付与する</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step={0.5}
                          min={0.5}
                          value={grantPointsInput}
                          onChange={(e) => setGrantPointsInput(e.target.value)}
                          className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <button
                          onClick={doGrantPoints}
                          disabled={granting}
                          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {granting ? '付与中...' : '付与する'}
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">倍率ルールは適用されず、入力した数値がそのまま付与されます。</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">クーポンを発行する</label>
                      <div className="flex gap-2">
                        <select
                          value={selectedCouponTemplateId}
                          onChange={(e) => setSelectedCouponTemplateId(e.target.value)}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="">クーポンを選択...</option>
                          {couponTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <button
                          onClick={doIssueCoupon}
                          disabled={issuingCoupon || !selectedCouponTemplateId}
                          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                        >
                          {issuingCoupon ? '発行中...' : '発行する'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h2 className="text-sm font-bold text-gray-900 mb-3">スタンプ付与履歴</h2>
                  {history.stampLogs.length === 0 ? (
                    <div className="text-sm text-gray-400">まだ履歴がありません</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {history.stampLogs.map((log) => (
                        <li key={log.id} className="text-sm text-gray-700 flex justify-between">
                          <span className="text-gray-500">{formatDateTime(log.created_at)}</span>
                          <span>
                            +{log.final_points}pt
                            {log.multiplier_applied !== 1 && <span className="text-gray-400"> （{log.multiplier_applied}倍）</span>}
                            <span className="text-gray-400 ml-2">{log.source}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h2 className="text-sm font-bold text-gray-900 mb-3">クーポン履歴</h2>
                  {history.coupons.length === 0 ? (
                    <div className="text-sm text-gray-400">まだ履歴がありません</div>
                  ) : (
                    <ul className="space-y-2">
                      {history.coupons.map((cp) => (
                        <li key={cp.id} className="flex items-center gap-3">
                          {cp.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={cp.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900">{cp.name}</div>
                            <div className="text-xs text-gray-500">
                              発行: {formatDateTime(cp.issuedAt)} ・ 期限: {formatDateTime(cp.expiresAt)}
                              {cp.usedAt && ` ・ 使用: ${formatDateTime(cp.usedAt)}`}
                            </div>
                          </div>
                          <span className="sc-badge text-xs shrink-0 rounded-full px-2 py-1 bg-gray-100 text-gray-700">{COUPON_STATUS_LABEL[cp.status]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
