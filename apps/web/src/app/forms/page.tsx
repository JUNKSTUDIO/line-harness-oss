'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { api, type FormSummary } from '@/lib/api'

export default function FormsPage() {
  const [forms, setForms] = useState<FormSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    const res = await api.forms.list()
    if (res.success) setForms(res.data)
    else setError(res.error)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function create() {
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    try {
      const res = await api.forms.create({ name: newName.trim() })
      if (res.success) {
        window.location.href = `/forms/detail?id=${res.data.id}`
      } else {
        setError(res.error)
      }
    } finally {
      setCreating(false)
    }
  }

  async function remove(form: FormSummary) {
    if (!confirm(`アンケート「${form.name}」を削除しますか？（これまでの回答データも削除されます）`)) return
    const res = await api.forms.delete(form.id)
    if (res.success) await load()
    else setError(res.error)
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div>
      <Header
        title="アンケート管理"
        description="アンケートを作成し、設問の選択肢ごとにタグ付与・点数加算・別シナリオへの移行を設定できます。"
      />
      <div className="p-6 space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">+ 新規アンケート</h2>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create() }}
              placeholder="アンケート名（例: ご来店満足度調査）"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={create}
              disabled={creating || !newName.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
            >
              {creating ? '作成中...' : '作成する'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">読み込み中...</div>
        ) : forms.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
            アンケートがありません。上のフォームから作成してください。
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状態</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">回答数</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最新回答</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {forms.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <Link href={`/forms/detail?id=${f.id}`} className="text-blue-600 hover:underline">
                        {f.name}
                      </Link>
                      {f.description && <div className="text-xs text-gray-400 mt-0.5">{f.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {f.isActive ? (
                        <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">公開中</span>
                      ) : (
                        <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">非公開</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900">{f.submitCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(f.lastSubmittedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => remove(f)} className="text-xs text-red-600 hover:underline">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
