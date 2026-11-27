// Adapted from KOZMOS Hourglass by Ersin Koç (MIT).
import type { Forecast, Reading, LimitData, WindowId } from '../types'
export type { WindowId } from '../types'
import { t } from './i18n'
import type { Lang } from './i18n'

const HOUR = 3600_000
const MIN_SPAN = 10 * 60_000
export const LIMIT_STORE = 'limit-windows-v1'

type Memory = { resetsAt?: number; samples: [number, number][] }
type Saved = {
  history: Partial<Record<WindowId, Memory>>
  alerts: Record<string, number[]>
}

export const WINDOWS = {
  claude5: { team: 'Claude', label: '5 h', hours: 5 },
  claude7: { team: 'Claude', label: '7 d', hours: 168 },
  codex5: { team: 'Codex', label: '5 h', hours: 5 },
  codex7: { team: 'Codex', label: '7 d', hours: 168 },
} as const

export function readings(d: LimitData): Record<WindowId, Reading | undefined> {
  const claude = (kind: string): Reading | undefined => {
    const l = d.limits.find(l => l.kind === kind)
    if (!l || !Number.isFinite(l.percentUsed)) return undefined
    const reset = Date.parse(l.resetsAt ?? '')
    return { used: l.percentUsed, resetsAt: Number.isFinite(reset) ? reset : undefined, at: d.now }
  }
  return { claude5: claude('five_hour'), claude7: claude('seven_day'), codex5: d.codex?.five, codex7: d.codex?.week }
}

export function observe(memory: Memory | undefined, r: Reading, hours: number): Memory {
  const same = memory && memory.resetsAt === r.resetsAt ? memory : undefined
  const previous = same?.samples.at(-1)
  if (same && previous && r.at <= previous[0]) return same
  const samples = same && previous && r.used >= previous[1] - 0.5 ? same.samples : []
  const lookback = (hours === 5 ? 1.5 : 24) * HOUR
  const recent = samples.filter(([at]) => at >= r.at - lookback)
  if (!previous || !recent.length || previous[1] !== r.used || r.at - previous[0] >= 5 * 60_000) {
    recent.push([r.at, r.used])
  }
  return { resetsAt: r.resetsAt, samples: recent.slice(-64) }
}

export function forecast(r: Reading, memory: Memory, hours: number, now: number): Forecast {
  const resetIn = r.resetsAt === undefined ? undefined : r.resetsAt - now
  if (resetIn !== undefined && resetIn <= 0) return {}
  const first = memory.samples[0]
  const last = memory.samples.at(-1)
  const elapsed = r.resetsAt === undefined ? 0 : r.at - (r.resetsAt - hours * HOUR)
  const rate = first && last && last[0] - first[0] >= MIN_SPAN
    ? Math.max(0, (last[1] - first[1]) * HOUR / (last[0] - first[0]))
    : elapsed >= MIN_SPAN ? Math.max(0, r.used * HOUR / elapsed) : undefined
  const etaMs = r.used >= 100 ? 0 : rate && rate > 0.01 ? (100 - r.used) * HOUR / rate : undefined
  const verdict = resetIn === undefined ? undefined
    : etaMs !== undefined ? (etaMs < resetIn ? 'dry' : 'safe')
    : rate !== undefined ? 'safe' : undefined
  return { rate, etaMs, verdict }
}

export function wallTime(at: number): string {
  const d = new Date(at)
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}

export function verdictText(f: Forecast | undefined, now: number, lang?: Lang): string | undefined {
  if (f?.verdict === 'dry') return t(lang, 'alert.runsOut', { time: wallTime(now + (f.etaMs ?? 0)) })
  if (f?.verdict === 'safe') return t(lang, 'alert.reachesReset')
}

export function crossings(fired: readonly number[], used: number): number[] {
  return [80, 95].filter(threshold => used >= threshold && !fired.includes(threshold))
}

export function updateLimits(live: LimitData, saved: unknown, lang?: Lang) {
  const current = readings(live)
  const now = live.now
  const stored = saved && typeof saved === 'object' ? saved as Partial<Saved> : {}
  const history = stored.history ?? {}
  const previousAlerts = stored.alerts ?? {}
  const next: Saved = {
    history: { ...history },
    alerts: Object.fromEntries(Object.entries(previousAlerts).filter(([key]) => Number(key.split(':')[1]) > now)),
  }
  const forecasts: LimitData['forecasts'] = {}
  const alerts: string[] = []
  for (const id of Object.keys(WINDOWS) as WindowId[]) {
    const r = current[id]
    if (!r || (r.resetsAt !== undefined && r.resetsAt <= now)) continue
    const { team, label, hours } = WINDOWS[id]
    const memory = observe(history[id], r, hours)
    const f = forecasts[id] = forecast(r, memory, hours, now)
    next.history[id] = memory
    if (r.resetsAt === undefined) continue
    const key = `${id}:${r.resetsAt}`
    const fired = next.alerts[key] ?? []
    const thresholds = crossings(fired, r.used)
    if (thresholds.length) next.alerts[key] = [...fired, ...thresholds]
    for (const threshold of thresholds) {
      const verdict = verdictText(f, now, lang)
      const pace = verdict ? t(lang, 'alert.pace', { verdict }) : t(lang, 'alert.paceUnknown')
      const mark = thresholds.length > 1 ? t(lang, 'alert.threshold', { n: threshold }) : ''
      alerts.push(t(lang, 'alert.text', { team, label, used: Math.round(r.used), mark, pace, time: wallTime(r.resetsAt) }))
    }
  }
  const changed = JSON.stringify(next) !== JSON.stringify({ history, alerts: previousAlerts })
  return { forecasts, alerts, memory: next, changed }
}
