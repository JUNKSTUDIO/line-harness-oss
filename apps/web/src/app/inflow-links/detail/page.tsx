'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import type { EntryRoute, EntryRouteFunnel } from '@line-crm/shared'

/** QRCodeSVGが描画したSVGをCanvas経由でPNGに変換し、ダウンロードさせる。店舗のテーブルPOPやチラシへの印刷用。 */
function downloadQrAsPng(svgContainer: HTMLDivElement, fileName: string) {
  const svg = svgContainer.querySelector('svg')
  if (!svg) return
  const svgData = new XMLSerializer().serializeToString(svg)
  const img = new Image()
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  img.onload = () => {
    // 印刷利用も想定し、表示サイズの4倍で書き出して粗くならないようにする。
    const scale = 4
    const canvas = document.createElement('canvas')
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    URL.revokeObjectURL(url)
    const pngUrl = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = pngUrl
    a.download = fileName
    a.click()
  }
  img.src = url
}

export default function InflowLinkDetailPage() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const [route, setRoute] = useState<EntryRoute | null>(null)
  const [funnel, setFunnel] = useState<EntryRouteFunnel | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [error, setError] = useState(id ? '' : 'id クエリパラメータが必要です')
  const qrRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      setLoading(true)
      const [r, f] = await Promise.all([api.entryRoutes.get(id), api.entryRoutes.funnel(id)])
      if (r.success) setRoute(r.data)
      else setError('リンクの取得に失敗しました')
      if (f.success) setFunnel(f.data)
      setLoading(false)
    })()
  }, [id])

  if (loading) {
    return <div className="p-12 text-center text-gray-500">読み込み中…</div>
  }
  if (!route) {
    return (
      <div className="p-12 text-center">
        <p className="text-red-600">{error || 'リンクが見つかりません'}</p>
        <Link href="/inflow-links" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
          ← 一覧に戻る
        </Link>
      </div>
    )
  }

  const url = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/r/${route.refCode}`

  return (
    <div>
      <Header title={route.name} description={`ref_code: ${route.refCode}`} />

      <Link
        href="/inflow-links"
        className="inline-block text-sm text-blue-600 hover:underline mb-4"
      >
        ← 一覧に戻る
      </Link>

      <div className="space-y-6">
        {funnel && <FunnelView funnel={funnel} />}

        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-2">
          <h3 className="text-sm font-medium text-gray-700">公開 URL</h3>
          <code className="block bg-gray-50 px-3 py-2 rounded text-xs font-mono break-all">
            {url}
          </code>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">QRコード</h3>
          <p className="text-xs text-gray-500">
            店頭POPやチラシなどに印刷して、このリンク経由の友だち追加を測定できます。読み取られたURLは上の公開URLと同じため、計測（友だち数・クリック数・ファネル）は通常のリンクと同様に記録されます。
          </p>
          <div ref={qrRef} className="flex justify-center py-2">
            <QRCodeSVG value={url} size={220} />
          </div>
          <div className="flex justify-center">
            <button
              onClick={() => qrRef.current && downloadQrAsPng(qrRef.current, `${route.name}-qr.png`)}
              className="text-sm text-blue-600 hover:underline"
            >
              QRコードをPNGでダウンロード
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FunnelView({ funnel }: { funnel: EntryRouteFunnel }) {
  const stages = [
    { label: 'クリック', value: funnel.click_count, prev: null as number | null },
    { label: '友だち追加', value: funnel.friend_add_count, prev: funnel.click_count },
    {
      label: 'フォーム送信',
      value: funnel.form_submission_count,
      prev: funnel.friend_add_count,
    },
    {
      label: 'コンバージョン',
      value: funnel.cv_count,
      prev: funnel.form_submission_count,
    },
  ]

  return (
    <div className="bg-white border border-gray-200 rounded p-4">
      <h3 className="text-sm font-medium mb-3">ファネル</h3>
      <div className="flex items-stretch gap-2 text-sm">
        {stages.map((s, i) => {
          const pct =
            s.prev !== null && s.prev > 0 ? ((s.value / s.prev) * 100).toFixed(1) : null
          return (
            <div key={s.label} className="flex-1 flex flex-col">
              <div className="bg-blue-50 rounded p-3 text-center flex-1 flex flex-col justify-center">
                <div className="text-xs text-gray-600">{s.label}</div>
                <div className="text-2xl font-bold text-blue-700 mt-1">
                  {s.value.toLocaleString()}
                </div>
                {pct !== null && (
                  <div className="text-xs text-gray-500 mt-1">{pct}%</div>
                )}
              </div>
              {i < stages.length - 1 && (
                <div className="text-center text-gray-400 text-xs mt-1">↓</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
