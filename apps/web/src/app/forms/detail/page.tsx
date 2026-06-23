'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { api, type FormDetail, type FormFieldDef, type FormFieldOption } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import type { Tag, Scenario } from '@line-crm/shared'

const FIELD_TYPE_LABEL: Record<FormFieldDef['type'], string> = {
  text: '1行テキスト',
  email: 'メールアドレス',
  tel: '電話番号',
  number: '数値',
  textarea: '長文テキスト',
  date: '日付',
  select: 'プルダウン選択',
  radio: '単一選択（ラジオ）',
  checkbox: '複数選択（チェックボックス）',
  rating: '評点（1〜5、点数として加算）',
}

const CHOICE_TYPES: FormFieldDef['type'][] = ['select', 'radio', 'checkbox']

function normalizeOptions(field: FormFieldDef): FormFieldOption[] {
  return (field.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
}

export default function FormDetailPage() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const { selectedAccount } = useAccount()
  const [form, setForm] = useState<FormDetail | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [templateMessage, setTemplateMessage] = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([api.forms.get(id), api.tags.list(), api.scenarios.list()]).then(([formRes, tagsRes, scenariosRes]) => {
      if (formRes.success) setForm(formRes.data)
      else setError(formRes.error)
      if (tagsRes.success) setTags(tagsRes.data)
      if (scenariosRes.success) setScenarios(scenariosRes.data)
      setLoading(false)
    })
  }, [id])

  function updateField(index: number, patch: Partial<FormFieldDef>) {
    setForm((f) => {
      if (!f) return f
      const fields = [...f.fields]
      fields[index] = { ...fields[index], ...patch }
      return { ...f, fields }
    })
    setSaved(false)
  }

  function addField() {
    setForm((f) => {
      if (!f) return f
      const n = f.fields.length + 1
      return { ...f, fields: [...f.fields, { name: `field_${n}`, label: '', type: 'text' }] }
    })
    setSaved(false)
  }

  function removeField(index: number) {
    if (!confirm('この設問を削除しますか？')) return
    setForm((f) => (f ? { ...f, fields: f.fields.filter((_, i) => i !== index) } : f))
    setSaved(false)
  }

  function moveField(index: number, dir: -1 | 1) {
    setForm((f) => {
      if (!f) return f
      const fields = [...f.fields]
      const target = index + dir
      if (target < 0 || target >= fields.length) return f
      ;[fields[index], fields[target]] = [fields[target], fields[index]]
      return { ...f, fields }
    })
    setSaved(false)
  }

  function setFieldOptions(fieldIndex: number, options: FormFieldOption[]) {
    updateField(fieldIndex, { options })
  }

  function addOption(fieldIndex: number) {
    const field = form!.fields[fieldIndex]
    const options = normalizeOptions(field)
    options.push({ value: `選択肢${options.length + 1}`, label: `選択肢${options.length + 1}` })
    setFieldOptions(fieldIndex, options)
  }

  function updateOptionLabel(fieldIndex: number, optionIndex: number, label: string) {
    const field = form!.fields[fieldIndex]
    const options = normalizeOptions(field)
    options[optionIndex] = { ...options[optionIndex], value: label, label }
    setFieldOptions(fieldIndex, options)
  }

  function updateOptionAction(fieldIndex: number, optionIndex: number, patch: Partial<FormFieldOption>) {
    const field = form!.fields[fieldIndex]
    const options = normalizeOptions(field)
    options[optionIndex] = { ...options[optionIndex], ...patch }
    setFieldOptions(fieldIndex, options)
  }

  function removeOption(fieldIndex: number, optionIndex: number) {
    const field = form!.fields[fieldIndex]
    setFieldOptions(fieldIndex, normalizeOptions(field).filter((_, i) => i !== optionIndex))
  }

  async function save() {
    if (!form) return
    setSaving(true)
    setError('')
    try {
      const res = await api.forms.update(form.id, {
        name: form.name,
        description: form.description,
        fields: form.fields,
        onSubmitTagId: form.onSubmitTagId,
        onSubmitScenarioId: form.onSubmitScenarioId,
        saveToMetadata: form.saveToMetadata,
        isActive: form.isActive,
      })
      if (res.success) {
        setForm(res.data)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      } else {
        setError(res.error)
      }
    } finally {
      setSaving(false)
    }
  }

  async function createGuideTemplate() {
    if (!form || !selectedAccount?.liffId) return
    setCreatingTemplate(true)
    setTemplateMessage('')
    setError('')
    try {
      const url = `https://liff.line.me/${selectedAccount.liffId}?page=form&id=${form.id}`
      const flex = {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: form.name, weight: 'bold', size: 'md', wrap: true },
            { type: 'text', text: 'アンケートにご協力ください🙏', size: 'sm', color: '#888888', margin: 'md' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: 'アンケートに回答する', uri: url } },
          ],
        },
      }
      const res = await api.templates.create({
        name: `アンケート誘導: ${form.name}`,
        category: 'general',
        messageType: 'flex',
        messageContent: JSON.stringify(flex),
      })
      if (res.success) {
        setTemplateMessage(`テンプレート「${res.data.name}」を作成しました。シナリオのステップで「テンプレート」モードからこのテンプレートを選ぶと配信できます。`)
      } else {
        setError(res.error)
      }
    } finally {
      setCreatingTemplate(false)
    }
  }

  if (loading) return <div><Header title="アンケート編集" /><div className="p-6 text-sm text-gray-500">読み込み中...</div></div>
  if (!form) {
    return (
      <div>
        <Header title="アンケート編集" />
        <div className="p-6">
          <p className="text-sm text-red-600">{error || 'アンケートが見つかりません'}</p>
          <Link href="/forms" className="text-sm text-blue-600 hover:underline mt-2 inline-block">← 一覧に戻る</Link>
        </div>
      </div>
    )
  }

  const liffUrl = selectedAccount?.liffId ? `https://liff.line.me/${selectedAccount.liffId}?page=form&id=${form.id}` : null

  return (
    <div>
      <Header title={form.name || 'アンケート編集'} description="設問・選択肢ごとにタグ付与・点数加算・別シナリオへの移行を設定できます。" />
      <div className="p-6 max-w-3xl space-y-6">
        <Link href="/forms" className="text-sm text-blue-600 hover:underline">← 一覧に戻る</Link>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

        <Section title="基本設定">
          <Field label="アンケート名">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <Field label="説明（任意）">
            <textarea
              value={form.description ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value || null } : f))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              rows={2}
            />
          </Field>
          <Field label="公開状態">
            <select
              value={form.isActive ? '1' : '0'}
              onChange={(e) => setForm((f) => (f ? { ...f, isActive: e.target.value === '1' } : f))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="1">公開中（回答を受け付ける）</option>
              <option value="0">非公開（回答を停止）</option>
            </select>
          </Field>
          <Field label="送信後に付与するタグ（アンケート全体で1つ・任意）">
            <select
              value={form.onSubmitTagId ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, onSubmitTagId: e.target.value || null } : f))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">設定なし</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="送信後に登録するシナリオ（アンケート全体で1つ・任意）">
            <select
              value={form.onSubmitScenarioId ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, onSubmitScenarioId: e.target.value || null } : f))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">設定なし</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="回答内容を友だちの属性として保存する">
            <select
              value={form.saveToMetadata ? '1' : '0'}
              onChange={(e) => setForm((f) => (f ? { ...f, saveToMetadata: e.target.value === '1' } : f))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="1">ON（各設問の回答を友だちの属性として保存する）</option>
              <option value="0">OFF</option>
            </select>
          </Field>
        </Section>

        <Section title="お客様向けURL / シナリオへの配布">
          {liffUrl ? (
            <>
              <UrlRow url={liffUrl} />
              <p className="text-xs text-gray-400">
                このURLをリッチメニューのボタンや、下のボタンで作るテンプレートに使えます。
              </p>
              <button
                onClick={createGuideTemplate}
                disabled={creatingTemplate}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {creatingTemplate ? '作成中...' : 'このアンケートに誘導するテンプレートを自動作成'}
              </button>
              {templateMessage && <p className="text-xs text-emerald-700 mt-1">{templateMessage}</p>}
            </>
          ) : (
            <p className="text-xs text-amber-700">LIFF IDが未設定のため、URLを表示できません。「LINEアカウント」設定でLIFF IDを登録してください。</p>
          )}
        </Section>

        <Section title="設問">
          <div className="space-y-4">
            {form.fields.map((field, fieldIndex) => (
              <FieldEditor
                key={fieldIndex}
                field={field}
                tags={tags}
                scenarios={scenarios}
                onUpdate={(patch) => updateField(fieldIndex, patch)}
                onRemove={() => removeField(fieldIndex)}
                onMoveUp={fieldIndex > 0 ? () => moveField(fieldIndex, -1) : undefined}
                onMoveDown={fieldIndex < form.fields.length - 1 ? () => moveField(fieldIndex, 1) : undefined}
                onAddOption={() => addOption(fieldIndex)}
                onUpdateOptionLabel={(optionIndex, label) => updateOptionLabel(fieldIndex, optionIndex, label)}
                onUpdateOptionAction={(optionIndex, patch) => updateOptionAction(fieldIndex, optionIndex, patch)}
                onRemoveOption={(optionIndex) => removeOption(fieldIndex, optionIndex)}
              />
            ))}
          </div>
          <button onClick={addField} className="text-sm text-blue-600 hover:underline mt-2">+ 設問を追加</button>
        </Section>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
          {saved && <span className="text-sm text-emerald-700">保存しました</span>}
        </div>
      </div>
    </div>
  )
}

function FieldEditor({
  field,
  tags,
  scenarios,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onAddOption,
  onUpdateOptionLabel,
  onUpdateOptionAction,
  onRemoveOption,
}: {
  field: FormFieldDef
  tags: Tag[]
  scenarios: Scenario[]
  onUpdate: (patch: Partial<FormFieldDef>) => void
  onRemove: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onAddOption: () => void
  onUpdateOptionLabel: (optionIndex: number, label: string) => void
  onUpdateOptionAction: (optionIndex: number, patch: Partial<FormFieldOption>) => void
  onRemoveOption: (optionIndex: number) => void
}) {
  const isChoice = CHOICE_TYPES.includes(field.type)
  const options = normalizeOptions(field)

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
      <div className="flex items-start gap-2">
        <div className="flex-1 grid grid-cols-2 gap-2">
          <input
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder="設問文"
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm col-span-2"
          />
          <select
            value={field.type}
            onChange={(e) => onUpdate({ type: e.target.value as FormFieldDef['type'] })}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
          >
            {Object.entries(FIELD_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={!!field.required} onChange={(e) => onUpdate({ required: e.target.checked })} />
            必須項目にする
          </label>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={onMoveUp} disabled={!onMoveUp} className="text-xs text-gray-500 disabled:opacity-30">↑</button>
          <button onClick={onMoveDown} disabled={!onMoveDown} className="text-xs text-gray-500 disabled:opacity-30">↓</button>
          <button onClick={onRemove} className="text-xs text-red-600">削除</button>
        </div>
      </div>

      {field.type === 'rating' && (
        <p className="text-xs text-gray-500">回答した数値（1〜5）がそのまま友だちの点数に加算されます。</p>
      )}

      {isChoice && (
        <div className="space-y-1.5 pt-1 border-t border-gray-200">
          {options.map((option, optionIndex) => (
            <div key={optionIndex} className="flex items-center gap-1.5 flex-wrap bg-white rounded-lg p-2 border border-gray-100">
              <input
                value={option.label ?? option.value}
                onChange={(e) => onUpdateOptionLabel(optionIndex, e.target.value)}
                placeholder="選択肢の文言"
                className="border border-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-[100px]"
              />
              <select
                value={option.tagId ?? ''}
                onChange={(e) => onUpdateOptionAction(optionIndex, { tagId: e.target.value || null })}
                className="border border-gray-200 rounded px-1.5 py-1 text-xs"
                title="この選択肢を選んだらタグを付与"
              >
                <option value="">タグ: なし</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input
                type="number"
                value={option.scoreValue ?? ''}
                onChange={(e) => onUpdateOptionAction(optionIndex, { scoreValue: e.target.value ? Number(e.target.value) : null })}
                placeholder="点数"
                className="border border-gray-200 rounded px-1.5 py-1 text-xs w-16"
                title="この選択肢を選んだら加算する点数"
              />
              <select
                value={option.branchScenarioId ?? ''}
                onChange={(e) => onUpdateOptionAction(optionIndex, { branchScenarioId: e.target.value || null })}
                className="border border-gray-200 rounded px-1.5 py-1 text-xs"
                title="この選択肢を選んだら登録するシナリオ"
              >
                <option value="">移行先: なし</option>
                {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button onClick={() => onRemoveOption(optionIndex)} className="text-xs text-red-600">×</button>
            </div>
          ))}
          <button onClick={onAddOption} className="text-xs text-blue-600 hover:underline">+ 選択肢を追加</button>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function UrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // クリップボードAPIが使えない場合は表示されているテキストを手動選択してもらう
    }
  }
  return (
    <div className="flex items-stretch gap-1">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs font-mono bg-gray-50 text-gray-700 truncate"
      />
      <button
        type="button"
        onClick={onCopy}
        className="px-3 rounded text-xs font-medium border border-gray-200 hover:bg-gray-50 whitespace-nowrap"
      >
        {copied ? '✓ コピー済' : 'コピー'}
      </button>
    </div>
  )
}
