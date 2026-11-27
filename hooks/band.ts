import type { BandData, Reading } from '../types'
import { readings } from './limits'
import { clip, modelName } from './lib/kz'
import { geminiModelName } from './gemini'
import { turno } from './turno'
import type { Miembro } from './turno'
import { formatNumber, t } from './i18n'
import type { Lang } from './i18n'

export type Segment = { text: string; color?: string; bold?: boolean; dim?: boolean }
export type RowState = 'noQuota' | 'working' | 'available'
type Field = Segment[]

const GREEN = '#3FB950'
const AMBER = '#D29922'
const RED = '#F85149'
const GREY = '#8B949E'
const DARK_GREY = '#484F58'
const DOT = '●'
const OFF = '○'
const PAUSE = '⏸'
const MINUTE = 60_000
const GAP = '  '
const SOCIOS_MODEL_RE = /^(?:claude|gpt|opus|sonnet|haiku)(?:$|[-.\d])/i
const usedColor = (value: number) => value >= 90 ? RED : value >= 70 ? AMBER : GREEN
const percent = (n: number) => `${Math.round(n)} %`
const dim = (text: string): Segment => ({ text, dim: true })
const widthOf = (field: Field) => field.reduce((sum, segment) => sum + segment.text.length, 0)
const safeModel = (name: string) => name.replace(/[^\x20-\x7e—]/g, '?')
// Row labels keep the same width in every language: 6 characters plus a space.
const label = (text: string) => clip(text, 6).padEnd(6) + ' '

function modelField(name: string, state: RowState): Field {
  const text = clip(safeModel(name), 12).padEnd(12)
  if (state === 'noQuota') return [{ text, color: DARK_GREY, dim: true }]
  if (state === 'working') return [{ text, color: GREEN }]
  return [{ text }]
}

function titleField(text: string, color: string, state: RowState, pad = true): Field {
  const segment = (part: string): Segment => state === 'noQuota'
    ? { text: part, color: DARK_GREY, dim: true }
    : { text: part, color: state === 'working' ? GREEN : color, bold: true }
  return pad ? [segment(text.padEnd(6))] : [segment(text), { text: ' ' }]
}

function statusSegment(state: RowState, open: boolean): Segment {
  if (state === 'noQuota') return { text: PAUSE, color: DARK_GREY, dim: true }
  if (state === 'working') return { text: DOT, color: GREEN }
  return open ? { text: DOT, color: GREY } : { text: OFF, color: GREY }
}

// "↻ 42min", "↻ 2h10", "↻ 3d4h": time left before the window starts over.
export function resetText(at: number | undefined, now: number): string {
  if (at === undefined) return ''
  const minutes = Math.max(0, Math.ceil((at - now) / MINUTE))
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days) return `↻ ${days}d${hours % 24}h`
  return hours ? `↻ ${hours}h${String(minutes % 60).padStart(2, '0')}` : `↻ ${minutes}min`
}

// Both teams read the same way: the bar fills with the share used.
function quota(title: string, reading: Reading | undefined, now: number, reset: boolean, bars: boolean): Field {
  const heading = dim(label(title))
  if (!reading) return [heading, dim('—')]
  const used = Math.max(0, Math.min(100, reading.used))
  const filled = Math.round(used * 12 / 100)
  const text = percent(used).padStart(5)
  const when = reset ? resetText(reading.resetsAt, now) : ''
  return [
    heading,
    ...(bars ? [{ text: '█'.repeat(filled), color: usedColor(used) },
      dim('░'.repeat(12 - filled)), { text: ' ' }] : []),
    { text },
    ...(when ? [dim(' ' + when.padEnd(8))] : []),
  ].filter(segment => segment.text)
}

function cache(data: BandData, five?: Reading, week?: Reading): Segment {
  if (data.lastRequestAt === undefined) return dim('—')
  const ttl = five && week && five.used < 100 && week.used < 100 ? 60 : 5
  const left = ttl * MINUTE - (data.now - data.lastRequestAt)
  if (left <= 0) return { text: t(data.lang, 'band.expired'), color: RED }
  return { text: `${Math.ceil(left / MINUTE)} min`, color: left > 10 * MINUTE ? GREEN : AMBER }
}

type AgentRow = NonNullable<BandData['agents']>[number]

function agentModelOverride(agent: AgentRow): string | undefined {
  return /(?:^|[\s`])--model(?:=|\s+)["']?([\w.-]+)/i.exec(agent.task ?? '')?.[1]
}

export function agentMember(agent: AgentRow): Miembro {
  const type = (agent.type ?? '').toLowerCase()
  if (/^codex(?:$|[:-])/.test(type)) return 'Codex'
  if (type.split(':').at(-1) === 'gemini') {
    return SOCIOS_MODEL_RE.test(agentModelOverride(agent) ?? '') ? 'AGY-O' : 'AGY'
  }
  return 'Claude'
}

export function memberStates(data: BandData, turn = turno(data)): Record<Miembro, RowState> {
  const active = new Set((data.agents ?? []).filter(agent => agent.working).map(agentMember))
  if (data.sessionActive || data.working || data.model) active.add('Claude')
  // Only a real quota cut-off greys a row out; Claude's coordination reserve keeps it working.
  return Object.fromEntries(turn.puestos.map(({ nombre, nota }) => [
    nombre, nota === 'sinCupo' ? 'noQuota' : active.has(nombre) ? 'working' : 'available',
  ])) as Record<Miembro, RowState>
}

// Real reset after a 429 in red; otherwise the 5 h window estimated from its first request («≈»).
function geminiReset(data: BandData): Field {
  if (data.geminiResetsAt === undefined || data.geminiResetsAt <= data.now) return [dim(label('5 h') + t(data.lang, 'band.free'))]
  const left = resetText(data.geminiResetsAt, data.now).slice(2)
  if (data.geminiLimited) return [{ text: `${t(data.lang, 'band.limit')} ↻ ${left}`, color: RED, bold: true }]
  const count = data.geminiWindowCount ?? 0
  return [dim(label('5 h')), { text: `↻ ≈${left}` }, dim(t(data.lang, 'band.inWindow', { n: count }))]
}

function geminiToday(data: BandData): Field {
  const n = data.geminiToday ?? 0
  return [n ? { text: t(data.lang, n === 1 ? 'band.queriesOne' : 'band.queriesMany', { n }) } : dim(t(data.lang, 'band.noUseToday'))]
}

export function agoText(at: number, now: number, lang?: Lang): string {
  const minutes = Math.max(0, Math.floor((now - at) / MINUTE))
  if (minutes < 60) return t(lang, 'band.agoMin', { n: minutes })
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? t(lang, 'band.agoHour', { n: hours }) : t(lang, 'band.agoDay', { n: Math.floor(hours / 24) })
}

function tokenText(total: number, lang?: Lang): string {
  if (total >= 1e6) return `${formatNumber(total / 1e6, lang)} M tokens`
  if (total >= 1000) return `${formatNumber(total / 1000, lang)} k tokens`
  return `${total} tokens`
}

function memoryText(bytes: number, lang?: Lang): string {
  return bytes >= 1024 ** 3 ? `${formatNumber(bytes / 1024 ** 3, lang)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

function join(fields: Field[]): Field {
  return fields.filter(field => field.length).flatMap((field, index) => index ? [{ text: GAP }, ...field] : field)
}

function trimRow(row: Field): Field {
  while (row.length) {
    const last = row[row.length - 1]!
    const text = last.text.trimEnd()
    if (text) {
      row[row.length - 1] = { ...last, text }
      break
    }
    row.pop()
  }
  return row
}

function activeRow(data: BandData, columns: number, states: Record<Miembro, RowState>): Field {
  if (columns < 64) return []
  const groups = new Map<string, { count: number; working: number; member: Miembro }>()
  for (const agent of data.agents ?? []) {
    const member = agentMember(agent)
    const name = member === 'AGY' ? t(data.lang, 'band.agy')
      : member === 'AGY-O' ? t(data.lang, 'band.agyO')
      : member === 'Codex' ? 'Codex'
      : agent.model ? safeModel(modelName(agent.model)) : t(data.lang, 'band.modelPending')
    const group = groups.get(name) ?? { count: 0, working: 0, member }
    group.count++
    if (agent.working) group.working++
    groups.set(name, group)
  }
  const chip = (text: string, state: RowState): Field => {
    if (state === 'noQuota') return [{ text: PAUSE, color: DARK_GREY, dim: true }, { text: ` ${text}`, color: DARK_GREY, dim: true }]
    if (state === 'working') return [{ text: DOT, color: GREEN }, { text: ` ${text}`, color: GREEN }]
    return [{ text: DOT, color: GREY }, { text: ` ${text}` }]
  }
  const left = join([
    [dim(t(data.lang, 'band.active'))],
    ...(data.model ? [chip(safeModel(modelName(data.model)), states.Claude)] : []),
    ...Array.from(groups).sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) => {
      const state: RowState = states[group.member] === 'noQuota' ? 'noQuota' : group.working ? 'working' : 'available'
      return chip(`${name}${group.count > 1 ? ` ×${group.count}` : ''}`, state)
    }),
  ])
  const { memUsed, memTotal, claude, codex, gemini } = data.sys ?? {}
  const ram = memUsed !== undefined && memTotal && memTotal > 0 ? 100 * memUsed / memTotal : undefined
  const right = join([
    ...(ram === undefined ? [] : [[{ text: `RAM ${percent(ram)}`, color: usedColor(ram) }]]),
    ...(claude ? [[{ text: `Claude ${memoryText(claude.bytes, data.lang)}` }]] : []),
    ...(codex ? [[{ text: `Codex ${memoryText(codex.bytes, data.lang)}` }]] : []),
    ...(gemini ? [[{ text: `Gemini ${memoryText(gemini.bytes, data.lang)}` }]] : []),
  ])
  if (left.length === 1 && !right.length) return []
  const gap = columns - widthOf(left) - widthOf(right)
  // Sin espacio para la memoria, se queda solo con los modelos.
  if (gap < GAP.length) return widthOf(left) <= columns ? left : []
  return right.length ? [...left, { text: ' '.repeat(gap) }, ...right] : left
}


// Who really does the work: a bridge subagent (Haiku/Sonnet) only passes the job to Gemini or Codex.
export function agentLabel(agent: AgentRow, data: BandData): string {
  const own = agent.model ? safeModel(modelName(agent.model)) : t(data.lang, 'band.modelPendingInline')
  const member = agentMember(agent)
  if (member === 'AGY' || member === 'AGY-O') {
    const model = member === 'AGY-O' ? agentModelOverride(agent) : geminiModelName(data.geminiModel)
    return t(data.lang, 'band.via', { agent: `${member} ${model}`, model: own })
  }
  if (member === 'Codex') {
    return t(data.lang, 'band.via', { agent: `Codex ${data.codexModel?.replace(/^gpt-/i, 'GPT-') ?? ''}`.trimEnd(), model: own })
  }
  return own
}

// One row per subagent: "Background ● Sonnet 5.5  Assessment A design review". At most 4, then "+N more".
// "Turn    Gemini > Codex > Claude · Claude: delegate all": who should get work now.
const ZONE_KEY = { normal: 'zone.normal', delegar: 'zone.delegar', reserva: 'zone.reserva', critica: 'zone.critica' } as const
function turnoRow(data: BandData, columns: number, turn: ReturnType<typeof turno>): Field {
  if (columns < 40 || !data.now) return []
  const zona = turn.zonaClaude === 'normal' ? GREEN : turn.zonaClaude === 'delegar' ? AMBER : RED
  const row: Field = [dim(t(data.lang, 'band.turn').padEnd(7) + ' '),
    { text: turn.orden.length ? turn.orden.join(' > ') : t(data.lang, 'band.noQuota'), bold: true },
    dim('  · Claude: '), { text: t(data.lang, ZONE_KEY[turn.zonaClaude]), color: zona }]
  const vence = turn.puestos.find(p => p.nota === 'vence')
  if (vence) row.push(dim('  · '), { text: t(data.lang, 'band.resetsIn', { name: vence.nombre, n: vence.renuevaMin ?? 0 }), color: AMBER })
  return widthOf(row) <= columns ? row : row.slice(0, 2)
}

function agentRows(data: BandData, columns: number, states: Record<Miembro, RowState>): Field[] {
  const list = data.agents ?? []
  if (columns < 64 || !list.length) return []
  const shown = list.slice(0, list.length > 4 ? 3 : 4)
  const background = t(data.lang, 'band.background')
  const rows: Field[] = shown.map(agent => {
    const who = agentLabel(agent, data)
    const member = agentMember(agent)
    const state: RowState = states[member] === 'noQuota' ? 'noQuota' : agent.working ? 'working' : 'available'
    const dot: Segment = state === 'noQuota' ? { text: PAUSE, color: DARK_GREY, dim: true }
      : state === 'working' ? { text: DOT, color: GREEN } : { text: DOT, color: GREY }
    const whoSeg: Segment = state === 'noQuota' ? { text: ` ${who}`, color: DARK_GREY, dim: true }
      : state === 'working' ? { text: ` ${who}`, color: GREEN } : { text: ` ${who}` }
    const head: Field = [dim(background + ' '), dot, whoSeg]
    const room = columns - widthOf(head) - GAP.length
    const task = agent.task ? agent.task.replace(/[\u0000-\u001f\u007f]/g, ' ') : ''
    return room > 4 && task ? [...head, dim(GAP + clip(task, room))] : head
  })
  if (list.length > shown.length) rows.push([dim(`${background} ${t(data.lang, 'band.more', { n: list.length - shown.length })}`)])
  return rows.map(row => widthOf(row) <= columns ? row : [{ text: clip(row.map(s => s.text).join(''), columns) }])
}

export function bandRows(data: BandData, columns: number): Field[] {
  if (columns < 6) return []
  const { claude5, claude7, codex5, codex7 } = readings(data)
  const turn = turno(data)
  const states = memberStates(data, turn)
  const codexModel = data.codexModel?.replace(/^gpt-/i, 'GPT-')
  const noCodex = !codex5 && !codex7 && data.codexToday === undefined && !codexModel
  const claudeTitle = titleField('CLAUDE', '#D97757', states.Claude)
  const codexTitle = titleField('CODEX', '#10A37F', states.Codex)
  const geminiTitle = titleField(t(data.lang, 'band.agy'), '#4285F4', states.AGY)
  const sociosTitle = titleField(t(data.lang, 'band.agyO'), '#4285F4', states['AGY-O'], false)
  // Real quota from `agy -p /usage` when it answered; otherwise the old log estimate.
  const { five: gemini5, week: gemini7 } = data.geminiLimits ?? {}
  const { five: socios5, week: socios7 } = data.sociosLimits ?? {}
  const geminiReal = !!(gemini5 || gemini7)

  // Each layout sheds detail while keeping the fields shared by the four rows aligned.
  const layouts = [
    'extras resets week bars model five state empty tags',
    'resets week bars model five state empty tags',
    'week bars model five state empty tags',
    'bars model five state empty tags',
    'week model five state empty tags',
    'model five state empty tags',
    'five state empty tags',
    'five state tags',
    'state tags',
    'five state empty',
    'state',
    '',
  ]
  for (const layout of layouts) {
    const fields = layout.split(' ')
    const show = (field: string) => fields.includes(field)
    // One column per window, padded to the widest of the four rows so the bars line up.
    const slot = (title: string, ...readings: (Reading | undefined)[]): Field[] => {
      const fields = readings.map(r => quota(title, r, data.now, show('resets'), show('bars')))
      const width = Math.max(...fields.map(widthOf))
      return fields.map(field => [...field, { text: ' '.repeat(width - widthOf(field)) }])
    }
    const [a5 = [], b5 = [], g5 = [], s5 = []] = show('five') ? slot('5 h', claude5, codex5, gemini5, socios5) : []
    const [a7 = [], b7 = [], g7 = [], s7 = []] = show('week') ? slot(t(data.lang, 'band.week'), claude7, codex7, gemini7, socios7) : []
    const prefix = (title: Field, model: string, state: RowState, open: boolean): Field[] => {
      const marker = show('tags') && state !== 'available' ? { text: ' ' } : statusSegment(state, open)
      return [title, [
        ...(show('state') ? [marker, { text: ' ' }] : []),
        ...(show('model') ? modelField(model, state) : []),
      ]]
    }
    const stateTag = (state: RowState): Field[] => {
      if (!show('tags') || state === 'available') return []
      const tag = t(data.lang, state === 'noQuota' ? 'band.noQuota' : 'band.working')
      return [[statusSegment(state, false), { text: ' ' }, {
        text: tag, color: state === 'noQuota' ? DARK_GREY : GREEN, dim: state === 'noQuota' || undefined,
      }]]
    }
    const claude = trimRow(join([...prefix(claudeTitle, modelName(data.model), states.Claude, true), a5, a7,
      ...stateTag(states.Claude),
      ...(show('extras') ? [[dim(label(t(data.lang, 'band.cache'))), cache(data, claude5, claude7)]] : []),
    ]))
    const codex = trimRow(join([...prefix(codexTitle, codexModel ?? '—', states.Codex, !!data.sys?.codex?.count),
      ...(noCodex ? (show('empty') ? [[dim(t(data.lang, 'band.noData'))]] : []) : [b5, b7]),
      ...stateTag(states.Codex),
      ...(show('extras') && data.codexToday !== undefined
        ? [[dim(label(t(data.lang, 'band.today'))), { text: tokenText(data.codexToday, data.lang) }]] : []),
    ]))
    const gemini = trimRow(join([...prefix(geminiTitle, geminiModelName(data.geminiModel), states.AGY, !!data.sys?.gemini?.count),
      ...(geminiReal
        ? [g5!, g7!, ...(data.geminiLimited ? [[{ text: t(data.lang, 'band.limit'), color: RED, bold: true }]] : []),
          ...stateTag(states.AGY),
          ...(show('extras') ? [geminiToday(data)] : [])]
        : [...(show('five') ? [geminiReset(data)] : []), ...stateTag(states.AGY), ...(show('empty') ? [geminiToday(data)] : [])]),
      ...(show('extras') && data.geminiLastAt !== undefined
        ? [[dim(label(t(data.lang, 'band.last'))), { text: agoText(data.geminiLastAt, data.now, data.lang) }]] : []),
    ]))
    const socios = trimRow(join([...prefix(sociosTitle, data.sociosModel ?? '—', states['AGY-O'], !!data.sys?.gemini?.count),
      ...(socios5 || socios7 ? [s5, s7] : show('empty') ? [[dim(t(data.lang, 'band.noData'))]] : []),
      ...stateTag(states['AGY-O']),
    ]))
    const rows = [claude, codex, gemini, socios]
    if (rows.every(row => widthOf(row) <= columns)) {
      if (show('extras')) {
        for (const [row, models] of [[gemini, data.geminiModels], [socios, data.sociosModels]] as const) {
          const room = columns - widthOf(row) - GAP.length
          if (room > 0 && models?.length) row.push({ text: GAP }, dim(room === 1 ? '…' : clip(models.join('·'), room)))
        }
      }
      return [...rows, activeRow(data, columns, states), turnoRow(data, columns, turn), ...agentRows(data, columns, states)].filter(row => row.length)
    }
  }
  return []
}
