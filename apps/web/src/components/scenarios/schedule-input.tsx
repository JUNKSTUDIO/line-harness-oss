'use client'

import type { DeliveryMode } from '@line-crm/shared'

export type RelativeUnit = 'minutes' | 'hours' | 'days'

export interface ScheduleValue {
  delayMinutes: number
  /** relative mode の単位選択UI用 (delayMinutes と常に同期させる) */
  relativeUnit: RelativeUnit
  relativeUnitValue: number
  /** relative mode限定、単位「日」の時のみ有効。セットされていれば送信時刻を指定する。 */
  pinDeliveryTime: string | null
  /** relative mode限定。trueなら6〜14分早めて配信する。 */
  earlyJitterEnabled: boolean
  offsetDays: number
  offsetHours: number
  offsetMinutesRemainder: number
  deliveryTime: string
}

export const emptySchedule: ScheduleValue = {
  delayMinutes: 0,
  relativeUnit: 'minutes',
  relativeUnitValue: 0,
  pinDeliveryTime: null,
  earlyJitterEnabled: false,
  offsetDays: 0,
  offsetHours: 0,
  offsetMinutesRemainder: 0,
  deliveryTime: '09:00',
}

const UNIT_TO_MINUTES: Record<RelativeUnit, number> = { minutes: 1, hours: 60, days: 1440 }

function delayMinutesFromUnit(unit: RelativeUnit, unitValue: number): number {
  return unitValue * UNIT_TO_MINUTES[unit]
}

/** 既存ステップの delayMinutes (分) を編集UI用の (単位, 値) に戻す。1440/60で割り切れる方を優先する。 */
export function uiFromDelayMinutes(delayMinutes: number): { relativeUnit: RelativeUnit; relativeUnitValue: number } {
  if (delayMinutes !== 0 && delayMinutes % 1440 === 0) return { relativeUnit: 'days', relativeUnitValue: delayMinutes / 1440 }
  if (delayMinutes !== 0 && delayMinutes % 60 === 0) return { relativeUnit: 'hours', relativeUnitValue: delayMinutes / 60 }
  return { relativeUnit: 'minutes', relativeUnitValue: delayMinutes }
}

/**
 * elapsed mode の DB 上の offsetMinutes は 0..1439 なので、
 * UI 側では 時間+分 に分けて編集する。
 */
export function offsetMinutesFromUI(value: ScheduleValue): number {
  return value.offsetHours * 60 + value.offsetMinutesRemainder
}

export function uiFromOffsetMinutes(offsetMinutes: number | null | undefined) {
  const m = offsetMinutes ?? 0
  return { offsetHours: Math.floor(m / 60), offsetMinutesRemainder: m % 60 }
}

interface Props {
  mode: DeliveryMode
  value: ScheduleValue
  onChange: (next: ScheduleValue) => void
}

const inputCls =
  'w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

const unitOptions: { value: RelativeUnit; label: string }[] = [
  { value: 'days', label: '日' },
  { value: 'hours', label: '時間' },
  { value: 'minutes', label: '分' },
]

export default function ScheduleInput({ mode, value, onChange }: Props) {
  if (mode === 'relative') {
    return (
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600">次のメッセージ送信までの待ち時間</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={value.relativeUnitValue}
            onChange={(e) => {
              const unitValue = Math.max(0, Number(e.target.value) || 0)
              onChange({ ...value, relativeUnitValue: unitValue, delayMinutes: delayMinutesFromUnit(value.relativeUnit, unitValue) })
            }}
          />
          <select
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={value.relativeUnit}
            onChange={(e) => {
              const newUnit = e.target.value as RelativeUnit
              onChange({
                ...value,
                relativeUnit: newUnit,
                delayMinutes: delayMinutesFromUnit(newUnit, value.relativeUnitValue),
                // 単位を「日」以外に変えたら、時刻指定は意味を持たないので解除する
                pinDeliveryTime: newUnit === 'days' ? value.pinDeliveryTime : null,
              })
            }}
          >
            {unitOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span className="text-sm text-gray-700">後に配信</span>
        </div>

        {value.relativeUnit === 'days' && (
          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={value.pinDeliveryTime !== null}
                onChange={(e) => onChange({ ...value, pinDeliveryTime: e.target.checked ? '09:00' : null })}
              />
              <span>更に、送信時刻を指定する</span>
            </label>
            {value.pinDeliveryTime !== null && (
              <>
                <div className="flex items-center gap-2 mt-1 ml-6">
                  <input
                    type="time"
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={value.pinDeliveryTime}
                    onChange={(e) => onChange({ ...value, pinDeliveryTime: e.target.value })}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1 ml-6">
                  送信時刻を指定した場合、日数は「夜中0時をまたぐ」基準になります（指定しない場合は前ステップからの経過時間そのまま）
                </p>
              </>
            )}
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={value.earlyJitterEnabled}
              onChange={(e) => onChange({ ...value, earlyJitterEnabled: e.target.checked })}
            />
            <span>時間をランダムで早める</span>
          </label>
          <p className="text-xs text-gray-400 mt-0.5 ml-6">6〜14分早く配信することで予約配信と分かりづらくなります</p>
        </div>
      </div>
    )
  }
  if (mode === 'elapsed') {
    return (
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600">購読開始から</label>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={value.offsetDays}
            onChange={(e) => onChange({ ...value, offsetDays: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span className="text-sm text-gray-700">日</span>
          <input
            type="number"
            min={0}
            max={23}
            className={inputCls}
            value={value.offsetHours}
            onChange={(e) =>
              onChange({ ...value, offsetHours: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })
            }
          />
          <span className="text-sm text-gray-700">時間</span>
          <input
            type="number"
            min={0}
            max={59}
            className={inputCls}
            value={value.offsetMinutesRemainder}
            onChange={(e) =>
              onChange({
                ...value,
                offsetMinutesRemainder: Math.max(0, Math.min(59, Number(e.target.value) || 0)),
              })
            }
          />
          <span className="text-sm text-gray-700">分後に配信</span>
        </div>
      </div>
    )
  }
  // absolute_time
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-600">購読開始から</label>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={value.offsetDays}
          onChange={(e) => onChange({ ...value, offsetDays: Math.max(0, Number(e.target.value) || 0) })}
        />
        <span className="text-sm text-gray-700">日後の</span>
        <input
          type="time"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          value={value.deliveryTime}
          onChange={(e) => onChange({ ...value, deliveryTime: e.target.value })}
        />
        <span className="text-sm text-gray-700">に配信</span>
      </div>
      <p className="text-xs text-gray-400">ⓘ cron が 1 分粒度のため最大 1 分遅れる場合があります</p>
    </div>
  )
}

/**
 * ScheduleValue → API リクエストの schedule フィールド (delivery_mode に応じて取捨選択)
 */
export function buildSchedulePayload(mode: DeliveryMode, value: ScheduleValue) {
  if (mode === 'relative') {
    return {
      delayMinutes: value.delayMinutes,
      pinDeliveryTime: value.relativeUnit === 'days' ? value.pinDeliveryTime : null,
      earlyJitterEnabled: value.earlyJitterEnabled,
    }
  }
  if (mode === 'elapsed') {
    return {
      offsetDays: value.offsetDays,
      offsetMinutes: offsetMinutesFromUI(value),
    }
  }
  return {
    offsetDays: value.offsetDays,
    deliveryTime: value.deliveryTime,
  }
}
