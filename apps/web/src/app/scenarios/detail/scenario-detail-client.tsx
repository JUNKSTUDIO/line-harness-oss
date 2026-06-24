'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import Link from 'next/link'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode } from '@line-crm/shared'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import ScheduleInput, {
  emptySchedule,
  buildSchedulePayload,
  uiFromOffsetMinutes,
  type ScheduleValue,
} from '@/components/scenarios/schedule-input'
import BulkPreviewModal from '@/components/scenarios/bulk-preview-modal'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }

const MAX_BUBBLES = 5

const triggerOptions: { value: ScenarioTriggerType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加時' },
  { value: 'tag_added', label: 'タグ付与時' },
  { value: 'manual', label: '手動' },
]

const messageTypeOptions: { value: MessageType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'Flex' },
]

const modeBadgeStyle: Record<DeliveryMode, { bg: string; text: string; label: string }> = {
  relative: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Legacy' },
  elapsed: { bg: 'bg-blue-50', text: 'text-blue-700', label: '経過時間' },
  absolute_time: { bg: 'bg-amber-50', text: 'text-amber-700', label: '時刻指定' },
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return '即時'
  if (minutes < 60) return `${minutes}分後`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}時間後` : `${h}時間${m}分後`
  }
  const d = Math.floor(minutes / 1440)
  const remaining = minutes % 1440
  if (remaining === 0) return `${d}日後`
  const h = Math.floor(remaining / 60)
  return h > 0 ? `${d}日${h}時間後` : `${d}日${remaining}分後`
}

function formatScheduleLabel(mode: DeliveryMode | undefined, step: ScenarioStep): string {
  const m = mode ?? 'relative'
  if (m === 'relative') return formatDelay(step.delayMinutes)
  if (m === 'elapsed') {
    const days = step.offsetDays ?? 0
    const mins = step.offsetMinutes ?? 0
    const h = Math.floor(mins / 60)
    const r = mins % 60
    if (days === 0 && mins === 0) return '即時 (購読開始)'
    const parts: string[] = []
    if (days > 0) parts.push(`${days}日`)
    if (h > 0) parts.push(`${h}時間`)
    if (r > 0) parts.push(`${r}分`)
    return `購読開始から${parts.join('')}後`
  }
  // absolute_time
  return `購読開始から${step.offsetDays ?? 0}日後の ${step.deliveryTime ?? '00:00'}`
}

interface BubbleFormState {
  messageType: MessageType
  messageContent: string
  templateId: string | null
  inputMode: 'direct' | 'template'
}

function emptyBubble(): BubbleFormState {
  return { messageType: 'text', messageContent: '', templateId: null, inputMode: 'direct' }
}

interface StepFormState {
  stepOrder: number
  schedule: ScheduleValue
  bubbles: BubbleFormState[]
  onReachTagId: string | null
}

function emptyStepForm(stepOrder: number): StepFormState {
  return {
    stepOrder,
    schedule: { ...emptySchedule },
    bubbles: [emptyBubble()],
    onReachTagId: null,
  }
}

interface TemplateOpt {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

interface TagOpt {
  id: string
  name: string
}

interface ScenarioStats {
  enrolledTotal: number
  activeNow: number
  completed: number
  paused: number
  steps: Array<{ stepOrder: number; reachedCount: number; reachRate: number }>
}

interface ScenarioListItem {
  id: string
  name: string
  isActive: boolean
}

function FlexPreview({ content }: { content: string }) {
  return <FlexPreviewComponent content={content} maxWidth={280} />
}

function ImagePreview({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content)
    const url = parsed.previewImageUrl || parsed.originalContentUrl
    return (
      <div>
        <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded mb-2 inline-block">画像</span>
        {url ? (
          <img src={url} alt="preview" className="max-w-[180px] rounded-lg border border-gray-200 mt-1" />
        ) : (
          <p className="text-xs text-gray-400">プレビューなし</p>
        )}
      </div>
    )
  } catch {
    return <p className="text-xs text-red-500">画像 JSON パースエラー</p>
  }
}

function SortableStepRow({
  step,
  selected,
  scheduleLabel,
  bubbleCount,
  preview,
  stat,
  onSelect,
  onDelete,
}: {
  step: ScenarioStep
  selected: boolean
  scheduleLabel: string
  bubbleCount: number
  preview: string
  stat?: { reachedCount: number; reachRate: number }
  onSelect: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
        selected ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="text-gray-400 cursor-grab pt-0.5 select-none"
        aria-label="ドラッグして並び替え"
      >
        ⋮⋮
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white shrink-0"
            style={{ backgroundColor: '#06C755' }}
          >
            {step.stepOrder}
          </span>
          <span className="text-xs text-gray-500">{scheduleLabel}</span>
          {bubbleCount > 1 && (
            <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">フキダシ×{bubbleCount}</span>
          )}
        </div>
        <p className="text-xs text-gray-700 truncate mt-1">{preview || '(空)'}</p>
        {stat && (
          <p className="text-[10px] text-purple-600 mt-0.5">
            📊 {stat.reachedCount}人到達 ({Math.round(stat.reachRate * 100)}%)
          </p>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="text-[10px] text-red-500 hover:text-red-700 shrink-0"
      >
        削除
      </button>
    </div>
  )
}

export default function ScenarioDetailClient({ scenarioId }: { scenarioId: string }) {
  const id = scenarioId
  const router = useRouter()

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [scenarioList, setScenarioList] = useState<ScenarioListItem[]>([])

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', triggerType: 'friend_add' as ScenarioTriggerType, isActive: true })
  const [saving, setSaving] = useState(false)

  const [showStepForm, setShowStepForm] = useState(false)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>(() => emptyStepForm(1))
  const [stepSaving, setStepSaving] = useState(false)
  const [stepError, setStepError] = useState('')

  const [previewOpen, setPreviewOpen] = useState(false)

  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [templates, setTemplates] = useState<TemplateOpt[]>([])
  const [tags, setTags] = useState<TagOpt[]>([])

  const deliveryMode: DeliveryMode = (scenario?.deliveryMode ?? 'relative') as DeliveryMode

  const loadScenario = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.get(id)
      if (res.success) {
        setScenario(res.data)
        setEditForm({
          name: res.data.name,
          description: res.data.description ?? '',
          triggerType: res.data.triggerType,
          isActive: res.data.isActive,
        })
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadScenario()
  }, [loadScenario])

  // 左カラム: シナリオ一覧 (画面切替なしで他シナリオへ移動できるように)
  useEffect(() => {
    api.scenarios.list().then((res) => {
      if (res.success) {
        setScenarioList(res.data.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive })))
      }
    }).catch(() => {})
  }, [])

  // 並列で stats / templates / tags を取得（リグレッションを起こさないよう失敗は無視）
  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api.scenarios.stats(id).catch(() => null),
      api.templates.list().catch(() => null),
      api.tags.list().catch(() => null),
    ]).then(([statsRes, tplRes, tagRes]) => {
      if (cancelled) return
      if (statsRes && statsRes.success) setStats(statsRes.data)
      if (tplRes && tplRes.success) {
        setTemplates(tplRes.data.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          messageType: t.messageType,
          messageContent: t.messageContent,
        })))
      }
      if (tagRes && tagRes.success) {
        setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      }
    })
    return () => { cancelled = true }
  }, [id])

  const reloadStats = useCallback(() => {
    api.scenarios.stats(id).then((r) => { if (r.success) setStats(r.data) }).catch(() => {})
  }, [id])

  const handleSaveScenario = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      const res = await api.scenarios.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        triggerType: editForm.triggerType,
        isActive: editForm.isActive,
      })
      if (res.success) {
        setEditing(false)
        loadScenario()
        setScenarioList((list) => list.map((s) => (s.id === id ? { ...s, name: editForm.name, isActive: editForm.isActive } : s)))
      } else {
        setError(res.error)
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const openAddStep = () => {
    const nextOrder = scenario ? (scenario.steps.length > 0 ? Math.max(...scenario.steps.map(s => s.stepOrder)) + 1 : 1) : 1
    setStepForm(emptyStepForm(nextOrder))
    setSelectedStepId(null)
    setShowStepForm(true)
    setStepError('')
  }

  const openEditStep = (step: ScenarioStep) => {
    const ui = uiFromOffsetMinutes(step.offsetMinutes)
    const sourceMessages = step.messages.length > 0
      ? step.messages
      : [{ id: null, orderIndex: 0, messageType: step.messageType, messageContent: step.messageContent, templateId: step.templateId ?? null }]
    setStepForm({
      stepOrder: step.stepOrder,
      schedule: {
        delayMinutes: step.delayMinutes,
        offsetDays: step.offsetDays ?? 0,
        offsetHours: ui.offsetHours,
        offsetMinutesRemainder: ui.offsetMinutesRemainder,
        deliveryTime: step.deliveryTime ?? '09:00',
      },
      bubbles: sourceMessages.map((m) => ({
        messageType: m.messageType,
        messageContent: m.messageContent,
        templateId: m.templateId ?? null,
        inputMode: m.templateId ? 'template' : 'direct',
      })),
      onReachTagId: step.onReachTagId ?? null,
    })
    setSelectedStepId(step.id)
    setShowStepForm(true)
    setStepError('')
  }

  const addBubble = () => {
    setStepForm((f) => (f.bubbles.length >= MAX_BUBBLES ? f : { ...f, bubbles: [...f.bubbles, emptyBubble()] }))
  }
  const removeBubble = (index: number) => {
    setStepForm((f) => ({ ...f, bubbles: f.bubbles.filter((_, i) => i !== index) }))
  }
  const updateBubble = (index: number, patch: Partial<BubbleFormState>) => {
    setStepForm((f) => {
      const bubbles = [...f.bubbles]
      bubbles[index] = { ...bubbles[index], ...patch }
      return { ...f, bubbles }
    })
  }

  const handleSaveStep = async () => {
    for (let i = 0; i < stepForm.bubbles.length; i++) {
      const b = stepForm.bubbles[i]
      if (b.inputMode === 'direct') {
        if (!b.messageContent.trim()) {
          setStepError(`フキダシ${i + 1}: メッセージ内容を入力してください`)
          return
        }
        if (b.messageType === 'flex' || b.messageType === 'image') {
          try {
            JSON.parse(b.messageContent)
          } catch {
            setStepError(`フキダシ${i + 1}: ${b.messageType === 'flex' ? 'Flex' : '画像'}メッセージの JSON が不正です`)
            return
          }
        }
      } else if (!b.templateId) {
        setStepError(`フキダシ${i + 1}: テンプレートを選択してください`)
        return
      }
    }
    setStepSaving(true)
    setStepError('')
    try {
      const schedulePayload = buildSchedulePayload(deliveryMode, stepForm.schedule)
      // テンプレートモードは templateId だけ送れば良い (サーバー側でテンプレ本文へスナップショットする)。
      const messages = stepForm.bubbles.map((b) =>
        b.inputMode === 'template' && b.templateId
          ? { templateId: b.templateId }
          : { messageType: b.messageType, messageContent: b.messageContent || ' ', templateId: null },
      )
      const payload = {
        stepOrder: stepForm.stepOrder,
        ...schedulePayload,
        messages,
        onReachTagId: stepForm.onReachTagId,
      }
      let savedId = selectedStepId
      if (selectedStepId) {
        const res = await api.scenarios.updateStep(id, selectedStepId, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      } else {
        const res = await api.scenarios.addStep(id, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
        savedId = res.data.id
      }
      setSelectedStepId(savedId)
      loadScenario()
      reloadStats()
    } catch {
      setStepError('ステップの保存に失敗しました')
    } finally {
      setStepSaving(false)
    }
  }

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('このステップを削除してもよいですか？')) return
    try {
      await api.scenarios.deleteStep(id, stepId)
      if (stepId === selectedStepId) {
        setSelectedStepId(null)
        setShowStepForm(false)
      }
      loadScenario()
      reloadStats()
    } catch {
      setError('ステップの削除に失敗しました')
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleStepDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id || !scenario) return
    const sorted = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
    const oldIndex = sorted.findIndex((s) => s.id === active.id)
    const newIndex = sorted.findIndex((s) => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(sorted, oldIndex, newIndex)
    try {
      await api.scenarios.reorderSteps(id, reordered.map((s, i) => ({ stepId: s.id, stepOrder: i + 1 })))
      loadScenario()
      reloadStats()
    } catch {
      setError('並び替えに失敗しました')
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-white rounded-lg border border-gray-200 p-8 animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-2/3" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!scenario) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">{error || 'シナリオが見つかりません'}</p>
          <Link href="/scenarios" className="text-sm text-green-600 hover:text-green-700 mt-4 inline-block">
            ← シナリオ一覧に戻る
          </Link>
        </div>
      </div>
    )
  }

  const sortedSteps = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const modeBadge = modeBadgeStyle[deliveryMode]

  const stepPreview = (step: ScenarioStep): string => {
    const first = step.messages[0]
    const content = first ? first.messageContent : step.messageContent
    const type = first ? first.messageType : step.messageType
    if (type === 'text') return content
    if (type === 'flex') return '[Flex メッセージ]'
    if (type === 'image') return '[画像]'
    return content
  }

  return (
    <div>
      <Header
        title="シナリオ詳細"
        action={
          <Link
            href="/scenarios"
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors inline-flex items-center"
          >
            ← シナリオ一覧
          </Link>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Stats Header Bar */}
      {stats && stats.enrolledTotal > 0 && (
        <div className="mb-4 bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm flex-wrap">
          <span className="font-medium text-gray-700">📊 集計</span>
          <span>登録 <span className="font-semibold">{stats.enrolledTotal}</span> 人</span>
          <span className="text-gray-400">/</span>
          <span>進行中 <span className="font-semibold text-blue-700">{stats.activeNow}</span></span>
          <span className="text-gray-400">/</span>
          <span>完了 <span className="font-semibold text-green-700">{stats.completed}</span></span>
          {stats.paused > 0 && (
            <>
              <span className="text-gray-400">/</span>
              <span>一時停止 {stats.paused}</span>
            </>
          )}
        </div>
      )}

      {/* 3カラムレイアウト (デスクトップ幅 lg+)。狭い画面では縦積みにフォールバック。 */}
      <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
        {/* Column 1: シナリオ一覧 */}
        <div className="w-full lg:w-56 lg:shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto">
          <div className="p-3 border-b border-gray-100">
            <Link href="/scenarios" className="text-xs text-green-600 hover:underline">配信シナリオ一覧</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {scenarioList.map((s) => (
              <button
                key={s.id}
                onClick={() => { if (s.id !== id) router.push(`/scenarios/detail?id=${s.id}`) }}
                className={`block w-full text-left px-3 py-2.5 text-sm transition-colors ${
                  s.id === id ? 'bg-green-50 text-green-800 font-medium' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                {s.name}
                {!s.isActive && <span className="ml-1 text-[10px] text-gray-400">(無効)</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Column 2: シナリオ情報 + ステップ一覧 (ドラッグ&ドロップで並び替え) */}
        <div className="w-full lg:w-[360px] lg:shrink-0 space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">シナリオ名 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                    rows={2}
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">トリガー</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={editForm.triggerType}
                    onChange={(e) => setEditForm({ ...editForm, triggerType: e.target.value as ScenarioTriggerType })}
                  >
                    {triggerOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editIsActive"
                    checked={editForm.isActive}
                    onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <label htmlFor="editIsActive" className="text-sm text-gray-600">有効</label>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveScenario}
                    disabled={saving}
                    className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(false)
                      setEditForm({
                        name: scenario.name,
                        description: scenario.description ?? '',
                        triggerType: scenario.triggerType,
                        isActive: scenario.isActive,
                      })
                    }}
                    className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h2 className="text-base font-semibold text-gray-900 break-words">{scenario.name}</h2>
                  <button
                    onClick={() => setEditing(true)}
                    className="text-xs font-medium text-green-600 hover:text-green-700 px-2 py-1 rounded-md hover:bg-green-50 transition-colors shrink-0"
                  >
                    編集
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${modeBadge.bg} ${modeBadge.text}`}>
                    {modeBadge.label}
                  </span>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      scenario.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {scenario.isActive ? '有効' : '無効'}
                  </span>
                </div>
                {scenario.description && (
                  <p className="text-xs text-gray-500 mb-2">{scenario.description}</p>
                )}
                <p className="text-xs text-gray-500">
                  トリガー: {triggerOptions.find(o => o.value === scenario.triggerType)?.label ?? scenario.triggerType}
                </p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">ステップ一覧</h3>
              <div className="flex gap-1">
                <button
                  onClick={() => setPreviewOpen(true)}
                  disabled={sortedSteps.length === 0}
                  className="px-2 py-1.5 min-h-[36px] text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  プレビュー
                </button>
                <button
                  onClick={openAddStep}
                  className="px-2 py-1.5 min-h-[36px] text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#06C755' }}
                >
                  + 追加
                </button>
              </div>
            </div>

            {sortedSteps.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-xs">
                ステップがありません。「+ 追加」から追加してください。
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleStepDragEnd}>
                <SortableContext items={sortedSteps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {sortedSteps.map((step) => (
                      <SortableStepRow
                        key={step.id}
                        step={step}
                        selected={step.id === selectedStepId && showStepForm}
                        scheduleLabel={formatScheduleLabel(deliveryMode, step)}
                        bubbleCount={step.messages.length}
                        preview={stepPreview(step)}
                        stat={stats?.steps.find((s) => s.stepOrder === step.stepOrder)}
                        onSelect={() => openEditStep(step)}
                        onDelete={() => handleDeleteStep(step.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* Column 3: 選択中ステップの編集 (複数フキダシ対応) */}
        <div className="w-full lg:flex-1 bg-white rounded-lg shadow-sm border border-gray-200 p-4 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto">
          {!showStepForm ? (
            <div className="text-center text-gray-400 text-sm py-16">
              左の一覧からステップを選択するか、「+ 追加」で新しいステップを作成してください
            </div>
          ) : (
            <div className="space-y-4 max-w-xl">
              <h4 className="text-sm font-medium text-gray-700">
                {selectedStepId ? `ステップ ${stepForm.stepOrder} を編集` : '新しいステップを追加'}
              </h4>

              <ScheduleInput
                mode={deliveryMode}
                value={stepForm.schedule}
                onChange={(schedule) => setStepForm({ ...stepForm, schedule })}
              />

              <div className="space-y-3">
                {stepForm.bubbles.map((bubble, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">フキダシ{i + 1}</span>
                      {stepForm.bubbles.length > 1 && (
                        <button onClick={() => removeBubble(i)} className="text-xs text-red-500 hover:text-red-700">削除</button>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={bubble.inputMode === 'direct'}
                          onChange={() => updateBubble(i, { inputMode: 'direct', templateId: null })}
                        />
                        <span>直接入力</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={bubble.inputMode === 'template'}
                          onChange={() => updateBubble(i, { inputMode: 'template' })}
                        />
                        <span>テンプレートを使う</span>
                      </label>
                    </div>
                    {bubble.inputMode === 'template' ? (
                      <select
                        value={bubble.templateId ?? ''}
                        onChange={(e) => updateBubble(i, { templateId: e.target.value || null })}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                      >
                        <option value="">-- 選択してください --</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}</option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <select
                          value={bubble.messageType}
                          onChange={(e) => updateBubble(i, { messageType: e.target.value as MessageType })}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                        >
                          {messageTypeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <textarea
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs resize-none"
                          rows={3}
                          placeholder="メッセージ内容を入力..."
                          value={bubble.messageContent}
                          onChange={(e) => updateBubble(i, { messageContent: e.target.value })}
                        />
                      </>
                    )}
                  </div>
                ))}

                {stepForm.bubbles.length < MAX_BUBBLES ? (
                  <button
                    onClick={addBubble}
                    className="w-full text-sm font-medium text-white rounded-lg py-2 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    + フキダシを追加する
                  </button>
                ) : (
                  <p className="text-xs text-amber-700">ⓘ LINE仕様により1ステップに送れるフキダシは最大{MAX_BUBBLES}個までです</p>
                )}
              </div>

              {/* 到達時のアクション */}
              <div className="pt-3 border-t border-gray-200 space-y-2">
                <h4 className="text-xs font-semibold text-gray-700">到達時のアクション</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">到達したらタグ付与</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={stepForm.onReachTagId ?? ''}
                    onChange={(e) => setStepForm({ ...stepForm, onReachTagId: e.target.value || null })}
                  >
                    <option value="">-- なし --</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-0.5">
                    このステップが配信完了したら、選んだタグを友だちに付与します
                  </p>
                </div>
              </div>

              {stepError && <p className="text-xs text-red-600">{stepError}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleSaveStep}
                  disabled={stepSaving}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {stepSaving ? '保存中...' : selectedStepId ? '更新' : '追加'}
                </button>
                <button
                  onClick={() => { setShowStepForm(false); setSelectedStepId(null); setStepError('') }}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </div>

              {/* 現在の内容のプレビュー (直接入力モードのフキダシのみ) */}
              {stepForm.bubbles.some((b) => b.inputMode === 'direct' && b.messageContent) && (
                <div className="pt-3 border-t border-gray-200 space-y-2">
                  <h4 className="text-xs font-semibold text-gray-700">プレビュー</h4>
                  {stepForm.bubbles.map((b, i) => {
                    if (b.inputMode !== 'direct' || !b.messageContent) return null
                    return (
                      <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded-md px-3 py-2">
                        {b.messageType === 'text' ? (
                          <p className="whitespace-pre-wrap break-words">{b.messageContent}</p>
                        ) : b.messageType === 'flex' ? (
                          <FlexPreview content={b.messageContent} />
                        ) : b.messageType === 'image' ? (
                          <ImagePreview content={b.messageContent} />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{b.messageContent}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <BulkPreviewModal
        open={previewOpen}
        scenarioId={id}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  )
}
