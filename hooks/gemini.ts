// Gemini (Antigravity CLI «agy»): lo que su registro dice de cada consulta.
// Google no publica el porcentaje usado; el registro trae el modelo elegido,
// la hora de cada consulta y, cuando corta, cuánto falta para el reinicio.

import type { CodexLimits } from '../types'

const HOUR = 3600_000
export const GEMINI_WINDOW_HOURS = 5

export type GeminiLog = {
  model?: { value: string; at: number }
  /** Hora de cada consulta del usuario (agy -p o un mensaje en la sesión). */
  requests: number[]
  /** El último corte 429: a qué hora se reinicia y cuándo se registró. */
  limit?: { resetsAt: number; at: number }
}

/** «cli-20261126_192532.log» → 2026. */
export function yearOfLog(name: string): number | undefined {
  const m = /^cli-(\d{4})\d{4}_\d{6}\.log$/.exec(name)
  return m ? Number(m[1]) : undefined
}

/** Duraciones de Go: «2s», «45m0s», «3h10m5.5s», «800ms». */
export function goDuration(text: string): number | undefined {
  const units: Record<string, number> = { h: HOUR, m: 60_000, s: 1000, ms: 1 }
  let total = 0
  let found = false
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(n) * units[unit!]!
    found = true
  }
  return found ? total : undefined
}

// glog: «I1126 19:26:47.087462 …», hora local sin año.
function stamp(line: string, year: number): number | undefined {
  const m = /^[IWEF](\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(line)
  if (!m) return undefined
  const [, mo, d, h, mi, s] = m.map(Number) as number[]
  return new Date(year, mo! - 1, d, h, mi, s).getTime()
}

export function parseGeminiLog(text: string, year: number): GeminiLog {
  const out: GeminiLog = { requests: [] }
  for (const line of text.split('\n')) {
    const at = stamp(line, year)
    if (at === undefined) continue
    // «Print mode: starting» precede al mismo mensaje en agy -p: contarlo duplicaría.
    if (line.includes('Sending user message')) out.requests.push(at)
    const label = /selected model override to backend: label="([^"]+)"/.exec(line)?.[1]
    if (label && at >= (out.model?.at ?? -Infinity)) out.model = { value: label, at }
    const reset = /quota will reset after ([0-9.hms]+)/.exec(line)?.[1]
    const wait = reset ? goDuration(reset) : undefined
    if (wait !== undefined && at >= (out.limit?.at ?? -Infinity)) out.limit = { resetsAt: at + wait, at }
  }
  return out
}

/**
 * `agy -p /usage --output-format json`: la misma cuota que muestra la web de
 * Antigravity (pestaña Modelos). Toma el grupo de los modelos Gemini y pasa
 * «lo que queda» a «lo usado», como las lecturas de Claude y Codex.
 */
export function parseGeminiUsage(text: string, at: number): CodexLimits | undefined {
  let json: unknown
  try {
    json = JSON.parse(text.slice(text.indexOf('{')))
  } catch {
    return undefined
  }
  const groups = (json as { command?: { data?: { groups?: unknown } } })?.command?.data?.groups
  if (!Array.isArray(groups)) return undefined
  type Bucket = { id?: string; window?: string; remaining_fraction?: number; reset_time?: string }
  const group = groups.find((g: { name?: string; buckets?: Bucket[] }) =>
    /gemini/i.test(g?.name ?? '') || g?.buckets?.some(b => /^gemini-/.test(b?.id ?? '')))
  if (!Array.isArray(group?.buckets)) return undefined
  const out: CodexLimits = {}
  for (const b of group.buckets as Bucket[]) {
    const key = b.window === '5h' ? 'five' : b.window === 'weekly' ? 'week' : undefined
    if (!key || typeof b.remaining_fraction !== 'number' || !Number.isFinite(b.remaining_fraction)) continue
    const reset = b.reset_time ? Date.parse(b.reset_time) : NaN
    out[key] = {
      used: Math.max(0, Math.min(100, (1 - b.remaining_fraction) * 100)),
      // Sin uso, Google devuelve 1970-01-01: no hay reinicio que mostrar.
      resetsAt: Number.isFinite(reset) && reset > 0 ? reset : undefined,
      at,
    }
  }
  return out.five || out.week ? out : undefined
}

/** «Gemini 4 Neon (High)» → «4 Neon High». */
export function geminiModelName(label: string | undefined): string {
  if (!label) return 'Antigravity'
  return label.replace(/^gemini\s+/i, '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim() || 'Antigravity'
}

/**
 * Estimación de la ventana de 5 h: empieza con la primera consulta tras una
 * ventana vencida. Google no lo confirma; por eso la banda la marca con «≈».
 */
export function geminiWindow(requests: readonly number[], now: number): { resetsAt?: number; count: number } {
  let start: number | undefined
  let count = 0
  for (const at of [...requests].sort((a, b) => a - b)) {
    if (at > now) continue
    if (start === undefined || at >= start + GEMINI_WINDOW_HOURS * HOUR) {
      start = at
      count = 0
    }
    count++
  }
  if (start === undefined || start + GEMINI_WINDOW_HOURS * HOUR <= now) return { count: 0 }
  return { resetsAt: start + GEMINI_WINDOW_HOURS * HOUR, count }
}
