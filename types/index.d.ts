import type { Lang } from '../hooks/i18n'

export type Reading = { used: number; resetsAt?: number; at: number }
export type CodexLimits = Partial<Record<'five' | 'week', Reading>>
export type CodexTokens = { input: number; cached: number; output: number }
export type Forecast = { rate?: number; etaMs?: number; verdict?: 'safe' | 'dry' }
export type WindowId = 'claude5' | 'claude7' | 'codex5' | 'codex7'
export type ProcessMemory = { count: number; bytes: number }
export type GpuSnap = { util: number; memUsed: number; memTotal: number; temp: number; name: string }
export type SysSnap = {
  cpu?: number
  memUsed?: number
  memTotal?: number
  diskUsed?: number
  diskTotal?: number
  procs?: number
  gpu?: GpuSnap
  claude?: ProcessMemory
  codex?: ProcessMemory
  gemini?: ProcessMemory
}
export type ClaudeLimit = { kind: string; percentUsed: number; resetsAt?: string }
export type BandData = {
  now: number
  limits: ClaudeLimit[]
  model?: string
  working?: boolean
  lastRequestAt?: number
  /** Subagentes en marcha: modelo, si trabaja ahora, su tarea y su tipo (gemini, codex:codex-rescue…). */
  agents?: { model?: string; working: boolean; task?: string; type?: string }[]
  codex?: CodexLimits
  codexToday?: number
  codexModel?: string
  codexModifiedAt?: number
  /** Gemini (Antigravity CLI «agy»): última escritura de su registro y conversaciones de hoy. */
  geminiModifiedAt?: number
  geminiToday?: number
  /** Etiqueta del modelo elegido en agy, p. ej. «Gemini 4 Neon (High)». */
  geminiModel?: string
  geminiModelAt?: number
  sociosModel?: string
  sociosModelAt?: number
  /** Hora de la última consulta enviada a Gemini. */
  geminiLastAt?: number
  /** Reinicio de la cuota: real si Google cortó (429), estimado si no. */
  geminiResetsAt?: number
  geminiLimited?: boolean
  /** Cuota real de los modelos Gemini, de `agy -p /usage` (porcentaje usado). */
  geminiLimits?: CodexLimits
  sociosLimits?: CodexLimits
  geminiModels?: string[]
  sociosModels?: string[]
  /** Consultas dentro de la ventana de 5 h estimada. */
  geminiWindowCount?: number
  sys?: SysSnap
  /** Idioma de los textos visibles (por defecto, inglés). */
  lang?: Lang
}

export type LimitData = Pick<BandData, 'now' | 'limits' | 'codex'> & {
  forecasts?: Partial<Record<WindowId, Forecast>>
}
