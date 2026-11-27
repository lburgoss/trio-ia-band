import type { CodexLimits, CodexTokens } from '../types'
export type { CodexLimits, CodexTokens, Reading as CodexWindow } from '../types'
export type CodexTail = {
  limits: CodexLimits
  total?: number
  tokens?: CodexTokens
  plan?: { value: string; at: number }
  model?: { value: string; at: number }
  at?: number
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function parseCodexTail(text: string, fallbackAt = 0): CodexTail {
  const out: CodexTail = { limits: {} }
  for (const line of text.split('\n')) {
    if (!line.includes('{')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const p = event?.payload
    const stamp = Date.parse(event.timestamp ?? '')
    const at = Number.isFinite(stamp) ? stamp : fallbackAt
    if (event?.type === 'turn_context' && typeof p?.model === 'string' && at >= (out.model?.at ?? -Infinity)) {
      out.model = { value: p.model, at }
    }
    if (event?.type !== 'event_msg' || p?.type !== 'token_count') continue
    out.at = Math.max(out.at ?? at, at)
    const plan = p.rate_limits?.plan_type
    if (typeof plan === 'string' && at >= (out.plan?.at ?? -Infinity)) out.plan = { value: plan, at }
    const usage = p.info?.total_token_usage
    if (finite(usage?.input_tokens) || finite(usage?.cached_input_tokens) || finite(usage?.output_tokens)) {
      out.tokens = {
        input: finite(usage.input_tokens) ? usage.input_tokens : 0,
        cached: finite(usage.cached_input_tokens) ? usage.cached_input_tokens : 0,
        output: finite(usage.output_tokens) ? usage.output_tokens : 0,
      }
    }
    if (finite(usage?.total_tokens)) out.total = usage.total_tokens
    else if (finite(usage?.input_tokens) || finite(usage?.output_tokens)) {
      out.total = (finite(usage.input_tokens) ? usage.input_tokens : 0)
        + (finite(usage.output_tokens) ? usage.output_tokens : 0)
    }

    for (const rate of Object.values(p.rate_limits ?? {})) {
      if (!rate || typeof rate !== 'object') continue
      const { used_percent: used, window_minutes: minutes, resets_at: abs, resets_in_seconds: rel } = rate as Record<string, unknown>
      if (!finite(used) || !finite(minutes)) continue
      const kind = minutes >= 240 && minutes <= 360 ? 'five'
        : minutes >= 9000 && minutes <= 11000 ? 'week' : undefined
      if (!kind) continue
      let resetsAt: number | undefined
      if (finite(abs) && abs > 0) resetsAt = abs > 1e12 ? abs : abs * 1000
      else if (finite(rel) && at > 0) resetsAt = at + rel * 1000
      if (at >= (out.limits[kind]?.at ?? -Infinity)) {
        out.limits[kind] = { used: Math.min(100, Math.max(0, used)), resetsAt, at }
      }
    }
  }
  return out
}

export function codexDays(now: number): [string, string] {
  const day = new Date(now)
  const path = () => `${day.getFullYear()}/${String(day.getMonth() + 1).padStart(2, '0')}/${String(day.getDate()).padStart(2, '0')}`
  const today = path()
  day.setDate(day.getDate() - 1)
  return [today, path()]
}

export function mergeCodexLimits(limits: CodexLimits, incoming: CodexLimits): void {
  for (const kind of ['five', 'week'] as const) {
    const window = incoming[kind]
    if (window && window.at >= (limits[kind]?.at ?? -Infinity)) limits[kind] = window
  }
}
