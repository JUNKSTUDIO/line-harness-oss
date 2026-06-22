'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import type { Tag } from '@line-crm/shared'

const DEFAULT_COLOR = '#3B82F6'

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    const res = await api.tags.list()
    if (res.success) setTags(res.data)
    else setError(res.error)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function create() {
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      const res = await api.tags.create({ name: name.trim(), color })
      if (res.success) {
        setName('')
        setColor(DEFAULT_COLOR)
        await load()
      } else {
        setError(res.error)
      }
    } finally {
      setCreating(false)
    }
  }

  async function remove(tag: Tag) {
    if (!confirm(`タグ「${tag.name}」を削除しますか？（このタグが付与されていた友だちからは外れます）`)) return
    const res = await api.tags.delete(tag.id)
    if (res.success) await load()
    else setError(res.error)
  }

  return (
    <div>
      <Header
        title="タグ管理"
        description="友だちの絞り込み・シナリオトリガー・自動付与などで使うタグを作成・削除します。友だちへの付与は「友だち管理」画面から行います。"
      />
      <div className="p-6 max-w-2xl space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">+ 新規タグ</h2>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded border border-gray-300 cursor-pointer shrink-0"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create() }}
              placeholder="タグ名（例: VIP）"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={create}
              disabled={creating || !name.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
            >
              {creating ? '作成中...' : '作成する'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">読み込み中...</div>
        ) : tags.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">タグがありません。上のフォームから作成してください。</div>
        ) : (
          <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {tags.map((tag) => (
              <li key={tag.id} className="flex items-center justify-between px-4 py-3">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                >
                  {tag.name}
                </span>
                <button onClick={() => remove(tag)} className="text-xs text-red-600 hover:underline">
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
