import type { BandData, Reading } from '../types'
import { readings } from './limits'
import { clip, modelName } from './lib/kz'
import { geminiModelName } from './gemini'
import { turno } from './turno'
import { formatNumber, t } from './i18n'
import type { Lang } from './i18n'

export type Segment = { text: string; color?: string; bold?: boolean; dim?: boolean }
type Field = Segment[]

const GREEN = '#3FB950'
const AMBER = '#D29922'
const RED = '#F85149'
const GREY = '#8B949E'
const DOT = '●'
const OFF = '○'
const MINUTE = 60_000
const GAP = '  '
const usedColor = (value: number) => value >= 90 ? RED : value >= 70 ? AMBER : GREEN
const percent = (n: number) => `${Math.round(n)} %`
const dim = (text: string): Segment => ({ text, dim: true })
const widthOf = (field: Field) => field.reduce((sum, segment) => sum + segment.text.length, 0)
const safeModel = (name: string) => name.replace(/[^\x20-\x7e—]/g, '?')
// Row labels keep the same width in every language: 6 characters plus a space.
const label = (text: string) => clip(text, 6).padEnd(6) + ' '

function modelField(name: string): Field {
  const safe = safeModel(name)
  return [{ text: clip(safe, 12).padEnd(12) }]
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

// Green ● working; grey ● open and idle; grey ○ not running. No orange: it read as a warning.
function codexState(data: BandData): Segment {
  if (data.codexModifiedAt !== undefined && data.now - data.codexModifiedAt < 30_000) return { text: DOT, color: GREEN }
  return data.sys?.codex?.count ? { text: DOT, color: GREY } : { text: OFF, color: GREY }
}

// Gemini (Antigravity CLI): green while it writes its log, grey ● while agy is open, grey ○ otherwise.
function geminiState(data: BandData): Segment {
  if (data.geminiModifiedAt !== undefined && data.now - data.geminiModifiedAt < 30_000) return { text: DOT, color: GREEN }
  return data.sys?.gemini?.count ? { text: DOT, color: GREY } : { text: OFF, color: GREY }
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

function activeRow(data: BandData, columns: number): Field {
  if (columns < 64) return []
  const groups = new Map<string, { count: number; working: number }>()
  for (const agent of data.agents ?? []) {
    const type = (agent.type ?? '').toLowerCase()
    const name = type === 'gemini' ? 'Gemini' : type.startsWith('codex') ? 'Codex'
      : agent.model ? safeModel(modelName(agent.model)) : t(data.lang, 'band.modelPending')
    const group = groups.get(name) ?? { count: 0, working: 0 }
    group.count++
    if (agent.working) group.working++
    groups.set(name, group)
  }
  const left = join([
    [dim(t(data.lang, 'band.active'))],
    ...(data.model ? [[{ text: DOT, color: data.working ? GREEN : GREY }, { text: ` ${safeModel(modelName(data.model))}` }]] : []),
    ...Array.from(groups).sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) =>
      [{ text: DOT, color: group.working ? GREEN : GREY }, { text: ` ${name}${group.count > 1 ? ` ×${group.count}` : ''}` }]),
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


type AgentRow = NonNullable<BandData['agents']>[number]

// Who really does the work: a bridge subagent (Haiku/Sonnet) only passes the job to Gemini or Codex.
export function agentLabel(agent: AgentRow, data: BandData): string {
  const own = agent.model ? safeModel(modelName(agent.model)) : t(data.lang, 'band.modelPendingInline')
  const type = (agent.type ?? '').toLowerCase()
  if (type === 'gemini') return t(data.lang, 'band.via', { agent: `Gemini ${geminiModelName(data.geminiModel)}`, model: own })
  if (type.startsWith('codex')) {
    return t(data.lang, 'band.via', { agent: `Codex ${data.codexModel?.replace(/^gpt-/i, 'GPT-') ?? ''}`.trimEnd(), model: own })
  }
  return own
}

// One row per subagent: "Background ● Sonnet 5.5  Assessment A design review". At most 4, then "+N more".
// "Turn    Gemini > Codex > Claude · Claude: delegate all": who should get work now.
const ZONE_KEY = { normal: 'zone.normal', delegar: 'zone.delegar', reserva: 'zone.reserva', critica: 'zone.critica' } as const
function turnoRow(data: BandData, columns: number): Field {
  if (columns < 40 || !data.now) return []
  const turn = turno(data)
  const zona = turn.zonaClaude === 'normal' ? GREEN : turn.zonaClaude === 'delegar' ? AMBER : RED
  const row: Field = [dim(t(data.lang, 'band.turn').padEnd(7) + ' '),
    { text: turn.orden.length ? turn.orden.join(' > ') : t(data.lang, 'band.noQuota'), bold: true },
    dim('  · Claude: '), { text: t(data.lang, ZONE_KEY[turn.zonaClaude]), color: zona }]
  const vence = turn.puestos.find(p => p.nota === 'vence')
  if (vence) row.push(dim('  · '), { text: t(data.lang, 'band.resetsIn', { name: vence.nombre, n: vence.renuevaMin ?? 0 }), color: AMBER })
  return widthOf(row) <= columns ? row : row.slice(0, 2)
}

function agentRows(data: BandData, columns: number): Field[] {
  const list = data.agents ?? []
  if (columns < 64 || !list.length) return []
  const shown = list.slice(0, list.length > 4 ? 3 : 4)
  const background = t(data.lang, 'band.background')
  const rows: Field[] = shown.map(agent => {
    const who = agentLabel(agent, data)
    const head: Field = [dim(background + ' '), { text: DOT, color: agent.working ? GREEN : GREY }, { text: ` ${who}` }]
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
  const claudeState: Segment = { text: DOT, color: data.working ? GREEN : GREY }
  const codexModel = data.codexModel?.replace(/^gpt-/i, 'GPT-')
  const noCodex = !codex5 && !codex7 && data.codexToday === undefined && !codexModel
  const claudeTitle = { text: 'CLAUDE', color: '#D97757', bold: true }
  const codexTitle = { text: 'CODEX ', color: '#10A37F', bold: true }
  const geminiTitle = { text: 'GEMINI', color: '#4285F4', bold: true }
  // Real quota from `agy -p /usage` when it answered; otherwise the old log estimate.
  const { five: gemini5, week: gemini7 } = data.geminiLimits ?? {}
  const geminiReal = !!(gemini5 || gemini7)

  // Each layout sheds detail while keeping the fields shared by both rows aligned.
  const layouts = [
    'extras resets week bars model five state empty',
    'resets week bars model five state empty',
    'week bars model five state empty',
    'bars model five state empty',
    'week model five state empty',
    'model five state empty',
    'five state empty',
    'five empty',
    'state',
    '',
  ]
  for (const layout of layouts) {
    const fields = layout.split(' ')
    const show = (field: string) => fields.includes(field)
    // One column per window, padded to the widest of the three rows so the bars line up.
    const slot = (title: string, ...readings: (Reading | undefined)[]): Field[] => {
      const fields = readings.map(r => quota(title, r, data.now, show('resets'), show('bars')))
      const width = Math.max(...fields.map(widthOf))
      return fields.map(field => [...field, { text: ' '.repeat(width - widthOf(field)) }])
    }
    const [a5 = [], b5 = [], g5 = []] = show('five') ? slot('5 h', claude5, codex5, gemini5) : [[], [], []]
    const [a7 = [], b7 = [], g7 = []] = show('week') ? slot(t(data.lang, 'band.week'), claude7, codex7, gemini7) : [[], [], []]
    const prefix = (title: Segment, model: string, status: Segment) => [
      // The dot sits right before the model it describes: "CLAUDE  ● Opus 5.5".
      [title], [...(show('state') ? [status, { text: ' ' }] : []), ...(show('model') ? modelField(model) : [])],
    ]
    const claude = trimRow(join([...prefix(claudeTitle, modelName(data.model), claudeState), a5, a7,
      ...(show('extras') ? [[dim(label(t(data.lang, 'band.cache'))), cache(data, claude5, claude7)]] : []),
    ]))
    const codex = trimRow(join([...prefix(codexTitle, codexModel ?? '—', codexState(data)),
      ...(noCodex ? (show('empty') ? [[dim(t(data.lang, 'band.noData'))]] : []) : [b5, b7]),
      ...(show('extras') && data.codexToday !== undefined
        ? [[dim(label(t(data.lang, 'band.today'))), { text: tokenText(data.codexToday, data.lang) }]] : []),
    ]))
    const gemini = trimRow(join([...prefix(geminiTitle, geminiModelName(data.geminiModel), geminiState(data)),
      ...(geminiReal
        ? [g5!, g7!, ...(data.geminiLimited ? [[{ text: t(data.lang, 'band.limit'), color: RED, bold: true }]] : []),
          ...(show('extras') ? [geminiToday(data)] : [])]
        : [...(show('five') ? [geminiReset(data)] : []), ...(show('empty') ? [geminiToday(data)] : [])]),
      ...(show('extras') && data.geminiLastAt !== undefined
        ? [[dim(label(t(data.lang, 'band.last'))), { text: agoText(data.geminiLastAt, data.now, data.lang) }]] : []),
    ]))
    if (widthOf(claude) <= columns && widthOf(codex) <= columns && widthOf(gemini) <= columns) {
      return [claude, codex, gemini, activeRow(data, columns), turnoRow(data, columns), ...agentRows(data, columns)].filter(row => row.length)
    }
  }
  return []
}
