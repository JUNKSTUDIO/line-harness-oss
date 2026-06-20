'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Header from '@/components/layout/header'
import { api, type CardGrantOperator } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

export default function GrantOperatorsPage() {
  const { selectedAccount, loading: accountLoading } = useAccount()
  const [operators, setOperators] = useState<CardGrantOperator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [regUrl, setRegUrl] = useState<string | null>(null)
  const [regExpiresAt, setRegExpiresAt] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)

  async function load() {
    if (!selectedAccount) return
    setLoading(true)
    const res = await api.cardGrantOperators.list(selectedAccount.id)
    if (res.success) setOperators(res.data)
    else setError(res.error)
    setLoading(false)
  }

  useEffect(() => { load() }, [selectedAccount]) // eslint-disable-line react-hooks/exhaustive-deps

  async function generateLink() {
    if (!selectedAccount) return
    setGenerating(true)
    setError('')
    try {
      const res = await api.cardGrantOperators.registrationLink(selectedAccount.id)
      if (res.success) {
        setRegUrl(res.data.url)
        setRegExpiresAt(res.data.expiresAt)
      } else {
        setError(res.error === 'liff_not_configured' ? 'LIFF IDが未設定です。先にLINEアカウント設定でLIFF IDを登録してください。' : res.error)
      }
    } finally {
      setGenerating(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('このスタッフのスタンプ付与権限を取り消しますか？')) return
    await api.cardGrantOperators.remove(id)
    setOperators((ops) => ops.filter((o) => o.id !== id))
  }

  if (accountLoading || (loading && selectedAccount)) {
    return <div><Header title="スタンプ付与スタッフ管理" /><div className="p-6 text-sm text-gray-500">読み込み中...</div></div>
  }
  if (!selectedAccount) {
    return <div><Header title="スタンプ付与スタッフ管理" /><div className="p-6 text-sm text-gray-500">LINEアカウントを選択してください</div></div>
  }

  const expired = regExpiresAt != null && regExpiresAt * 1000 < Date.now()

  return (
    <div>
      <Header
        title="スタンプ付与スタッフ管理"
        description="お客様のQRを読んでスタンプを付与できるのは、ここで登録したLINEアカウントだけです。未登録のアカウントでは付与が拒否されます（不正利用防止）。"
      />
      <div className="p-6 max-w-3xl space-y-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 text-center">
          <h2 className="text-sm font-bold text-gray-900 text-left">新しいスタッフを登録する</h2>
          <p className="text-xs text-gray-500 text-left">
            下のボタンでQRコードを発行し、登録したいスタッフ本人のスマホのLINEアプリのQRリーダーで読んでもらってください（本人が直接読む必要があります）。一度読むだけで登録完了します。
          </p>
          {regUrl && !expired ? (
            <div className="flex justify-center py-2">
              <QRCodeSVG value={regUrl} size={220} />
            </div>
          ) : (
            <button
              onClick={generateLink}
              disabled={generating}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {generating ? '発行中...' : expired ? '期限切れ — 登録用QRを再発行' : '登録用QRを発行する'}
            </button>
          )}
          {regUrl && !expired && <p className="text-xs text-gray-400">24時間有効です</p>}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2">スタッフ</th>
                <th className="text-left px-4 py-2">登録日</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {operators.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">登録済みスタッフはいません</td></tr>
              )}
              {operators.map((op) => (
                <tr key={op.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 flex items-center gap-2">
                    {op.picture_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={op.picture_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                    )}
                    {op.display_name ?? '(表示名なし)'}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{new Date(op.registered_at).toLocaleDateString('ja-JP')}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => remove(op.id)} className="text-xs text-rose-600 underline">権限を取り消す</button>
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
