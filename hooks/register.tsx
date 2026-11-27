import type { AgentInfo, EngineInterface, FsEntry, FsStat, Register } from 'claude-code'
import type { BandData, CodexLimits } from '../types'
import { bandRows } from './band'
import { codexDays, mergeCodexLimits, parseCodexTail } from './codex'
import type { CodexTail } from './codex'
import { tokensOf } from './lib/kz'
import { MAC_MEMSIZE, MAC_TOP, POSIX_PROCESSES, WIN_SYS, parseMacTop, parseMeminfo, parseProcessMemory, parseWinSys, platformFrom } from './lib/probe'
import type { Platform } from './lib/probe'
import { LIMIT_STORE, updateLimits } from './limits'
import { geminiWindow, parseGeminiLog, parseGeminiUsage, yearOfLog } from './gemini'
import type { GeminiLog } from './gemini'
import { isLang, t } from './i18n'
import type { Lang } from './i18n'

const TICK_MS = 1000
const PROBE_MS = 5000
const CODEX_SCAN_MS = 60_000
const CODEX_TAIL = 256 * 1024
const STORE_KEY = 'enabled'

async function sh($: EngineInterface, argv: readonly string[], timeoutMs: number): Promise<string | undefined> {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

async function listRollouts($: EngineInterface, dir: string): Promise<FsEntry[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  return entries.filter(f => f.kind === 'file' && /^rollout-.*\.jsonl$/.test(f.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function listDateFolders($: EngineInterface, dir: string, pattern: RegExp): Promise<string[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  return entries.filter(f => f.kind === 'dir' && pattern.test(f.name)).map(f => f.name).sort().reverse()
}

async function newestRollout($: EngineInterface, base: string): Promise<{ dir: string; file: FsEntry } | undefined> {
  for (const year of await listDateFolders($, base, /^\d{4}$/)) {
    for (const month of await listDateFolders($, `${base}/${year}`, /^\d{2}$/)) {
      const parent = `${base}/${year}/${month}`
      for (const day of await listDateFolders($, parent, /^\d{2}$/)) {
        const dir = `${parent}/${day}`
        const [file] = await listRollouts($, dir)
        if (file) return { dir, file }
      }
    }
  }
}

type Rollout = { size: number; mtimeMs: number; parsed: CodexTail; today: boolean }
type Loop = { model: string; turnId?: string }

let live: BandData = { limits: [], now: 0 }
let enabled = true
let sampling = false
let machineBusy = false
let platform: Platform | undefined
let probeAt = -Infinity
let codexScanAt = -Infinity
let codexPollAt = -Infinity
let newest: string | undefined
let agents: AgentInfo[] = []
let mainTurn: string | undefined
let tokenWrites = Promise.resolve()
const agentLoops = new Map<string, Loop>()
const rollouts = new Map<string, Rollout>()
const GEMINI_LOOKBACK = 26 * 3600_000
const GEMINI_TAIL = 2 * 1024 * 1024
const geminiLogs = new Map<string, { size: number; mtimeMs: number; parsed: GeminiLog }>()
const views = new Map<string, { columns: number; signature: string }>()
// La cuota real se pide a agy (~4 s, no gasta cuota): cada 2 min, o 30 s después de usar Gemini.
const GEMINI_USAGE_MS = 120_000
const GEMINI_USAGE_AFTER_USE_MS = 30_000
let geminiUsageAt = -Infinity
let geminiUsageBusy = false

async function refreshMachine($: EngineInterface) {
  if (!platform) {
    const os = await $.env.get('OS').catch(() => undefined)
    platform = platformFrom(os, /windows/i.test(os ?? '') ? undefined : await sh($, ['uname', '-s'], 1500))
  }
  if (platform === 'win') {
    const snapshot = await sh($, WIN_SYS, 4000)
    if (snapshot !== undefined) live.sys = parseWinSys(snapshot)
    return
  }
  const processes = sh($, POSIX_PROCESSES, 2500)
  const ram = platform === 'mac'
    ? Promise.all([sh($, MAC_TOP, 3000), sh($, MAC_MEMSIZE, 1500)]).then(([top, total]) => parseMacTop(top ?? '', total ?? ''))
    : $.fs.read('/proc/meminfo', { length: 8192 }).then(parseMeminfo).catch(() => ({}))
  live.sys = { ...await ram, ...parseProcessMemory(await processes ?? '') }
}

async function readRollout($: EngineInterface, path: string, file: FsStat, today: boolean): Promise<boolean> {
  const known = rollouts.get(path)
  if (known) known.today = today
  if (known && known.size === file.size && known.mtimeMs === file.mtimeMs) return false
  const offset = Math.max(0, file.size - CODEX_TAIL)
  let tail = ''
  try {
    if (file.size > 0) tail = await $.fs.read(path, { offset, length: file.size - offset })
  } catch {
    return false
  }
  if (offset > 0) {
    const newline = tail.indexOf('\n')
    tail = newline < 0 ? '' : tail.slice(newline + 1)
  }
  const parsed = parseCodexTail(tail, file.mtimeMs)
  if (known && file.size >= known.size && offset > 0) {
    parsed.model ??= known.parsed.model
    parsed.plan ??= known.parsed.plan
    parsed.limits.five ??= known.parsed.limits.five
    parsed.limits.week ??= known.parsed.limits.week
    parsed.total ??= known.parsed.total
  }
  rollouts.set(path, { size: file.size, mtimeMs: file.mtimeMs, parsed, today })
  return true
}

function collectCodex() {
  const limits: CodexLimits = {}
  let model: CodexTail['model']
  let total: number | undefined
  for (const { parsed, today } of rollouts.values()) {
    mergeCodexLimits(limits, parsed.limits)
    if (parsed.model && parsed.model.at >= (model?.at ?? -Infinity)) model = parsed.model
    if (today && parsed.total !== undefined) total = (total ?? 0) + parsed.total
  }
  live.codex = limits
  live.codexToday = total
  live.codexModel = model?.value
}

async function scanCodex($: EngineInterface, now: number) {
  let root = await $.env.get('CODEX_HOME')
  if (!root) {
    const home = await $.env.get('USERPROFILE') || await $.env.get('HOME')
    if (!home) return
    root = `${home}/.codex`
  }
  const base = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/sessions`
  const [today, yesterday] = codexDays(now)
  const seen = new Set<string>()
  let modifiedAt: number | undefined
  newest = undefined
  const visit = (dir: string, file: FsEntry) => {
    const path = `${dir}/${file.name}`
    if (seen.has(path)) return
    seen.add(path)
    if (file.mtimeMs > (modifiedAt ?? -Infinity)) {
      modifiedAt = file.mtimeMs
      newest = path
    }
    return path
  }
  for (const day of [today, yesterday]) {
    const dir = `${base}/${day}`
    for (const file of await listRollouts($, dir)) {
      const path = visit(dir, file)
      if (path) await readRollout($, path, file, day === today)
    }
  }
  const hasFive = [...seen].some(path => rollouts.get(path)?.parsed.limits.five)
  const hasWeek = [...seen].some(path => rollouts.get(path)?.parsed.limits.week)
  if (!newest || !hasFive || !hasWeek) {
    const fallback = await newestRollout($, base)
    if (fallback) {
      const path = visit(fallback.dir, fallback.file)
      if (path) await readRollout($, path, fallback.file, fallback.dir === `${base}/${today}`)
    }
  }
  for (const path of rollouts.keys()) if (!seen.has(path)) rollouts.delete(path)
  live.codexModifiedAt = modifiedAt
  collectCodex()
}

async function refreshCodex($: EngineInterface, now: number) {
  if (now - codexScanAt >= CODEX_SCAN_MS) {
    codexScanAt = codexPollAt = now
    await scanCodex($, now)
  } else if (newest && now - codexPollAt >= PROBE_MS) {
    codexPollAt = now
    const stat = await $.fs.stat(newest).catch(() => undefined)
    if (stat?.kind !== 'file') {
      live.codexModifiedAt = undefined
      return
    }
    live.codexModifiedAt = stat.mtimeMs
    const today = newest.includes(`/sessions/${codexDays(now)[0]}/`)
    if (await readRollout($, newest, stat, today)) collectCodex()
  }
}

// Gemini (Antigravity CLI «agy»): its log changes while it works; one .db per conversation.
async function refreshGemini($: EngineInterface, now: number) {
  const home = await $.env.get('USERPROFILE') || await $.env.get('HOME')
  if (!home) return
  const base = `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/.gemini/antigravity-cli`
  const log = await $.fs.stat(`${base}/cli.log`).catch(() => undefined)
  live.geminiModifiedAt = log?.kind === 'file' ? log.mtimeMs : undefined
  const files = (await $.fs.list(`${base}/log`).catch(() => []))
    .filter(f => f.kind === 'file' && yearOfLog(f.name) !== undefined && f.mtimeMs >= now - GEMINI_LOOKBACK)
  const seen = new Set<string>()
  for (const file of files) {
    const path = `${base}/log/${file.name}`
    seen.add(path)
    const known = geminiLogs.get(path)
    if (known && known.size === file.size && known.mtimeMs === file.mtimeMs) continue
    const offset = Math.max(0, file.size - GEMINI_TAIL)
    const text = await $.fs.read(path, { offset, length: file.size - offset }).catch(() => undefined)
    if (text === undefined) continue
    geminiLogs.set(path, { size: file.size, mtimeMs: file.mtimeMs, parsed: parseGeminiLog(text, yearOfLog(file.name)!) })
  }
  for (const path of geminiLogs.keys()) if (!seen.has(path)) geminiLogs.delete(path)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const requests: number[] = []
  let model: GeminiLog['model']
  let limit: GeminiLog['limit']
  for (const { parsed } of geminiLogs.values()) {
    requests.push(...parsed.requests)
    if (parsed.model && parsed.model.at >= (model?.at ?? -Infinity)) model = parsed.model
    if (parsed.limit && parsed.limit.at >= (limit?.at ?? -Infinity)) limit = parsed.limit
  }
  const window = geminiWindow(requests, now)
  live.geminiToday = requests.filter(at => at >= start.getTime()).length
  live.geminiLastAt = requests.length ? Math.max(...requests) : undefined
  live.geminiModel = model?.value
  live.geminiWindowCount = window.count
  // Un corte real (429) manda sobre la estimación mientras siga vigente.
  live.geminiLimited = !!limit && limit.resetsAt > now
  live.geminiResetsAt = live.geminiLimited ? limit!.resetsAt : window.resetsAt
}

async function refreshGeminiUsage($: EngineInterface, now: number) {
  const win = platform === 'win'
  const local = win ? await $.env.get('LOCALAPPDATA').catch(() => undefined) : undefined
  const agy = local ? `${local.replace(/\\/g, '/')}/agy/bin/agy.exe` : 'agy'
  // --log-file al vacío: sin él cada consulta dejaría un registro nuevo en antigravity-cli/log.
  const out = await sh($, [agy, '-p', '/usage', '--output-format', 'json', '--log-file', win ? 'NUL' : '/dev/null'], 20_000)
  const limits = out === undefined ? undefined : parseGeminiUsage(out, now)
  if (limits) live.geminiLimits = limits
  // Una lectura de más de 15 min ya no vale: la banda vuelve a la estimación.
  else if (live.geminiLimits && now - Math.max(live.geminiLimits.five?.at ?? 0, live.geminiLimits.week?.at ?? 0) > 15 * 60_000) live.geminiLimits = undefined
}

function redraw($: EngineInterface) {
  let changed = false
  for (const view of views.values()) {
    const signature = JSON.stringify(enabled ? bandRows(live, view.columns) : [])
    if (signature === view.signature) continue
    view.signature = signature
    changed = true
  }
  if (changed) $.ui.invalidate('ui.render')
}

function refreshAgents() {
  live.agents = agents.filter(agent => ['running', 'pending', 'waiting', 'idle'].includes(agent.status)).map(agent => {
    const loop = agentLoops.get(agent.id)
    return { model: loop?.model, working: loop ? loop.turnId !== undefined : agent.status === 'running', task: agent.description, type: agent.type }
  })
}

async function checkLimits($: EngineInterface) {
  if (!live.limits.length && !live.codex?.five && !live.codex?.week) return
  const saved = await $.store.get(LIMIT_STORE)
  const result = updateLimits(live, saved, live.lang)
  if (!result.changed) return
  await $.store.set(LIMIT_STORE, result.memory)
  for (const alert of result.alerts) $.ui.toast(alert)
}

async function sample($: EngineInterface) {
  if (sampling) return
  sampling = true
  try {
    const now = await $.clock.now()
    live.now = Math.max(live.now, now)
    const usage = await $.session.usage().catch(() => undefined)
    if (usage) live.limits = usage.rateLimits
    if (!mainTurn) {
      const model = await $.session.model().catch(() => undefined)
      if (!mainTurn && model) live.model = model
    }
    if (enabled && now - probeAt >= PROBE_MS) {
      probeAt = now
      if (!machineBusy) {
        machineBusy = true
        void refreshMachine($).then(() => redraw($)).catch(() => undefined).finally(() => { machineBusy = false })
      }
      await refreshGemini($, now).catch(() => undefined)
      const usedSince = (live.geminiModifiedAt ?? -Infinity) > geminiUsageAt
      if (platform && !geminiUsageBusy && (now - geminiUsageAt >= GEMINI_USAGE_MS || (usedSince && now - geminiUsageAt >= GEMINI_USAGE_AFTER_USE_MS))) {
        geminiUsageAt = now
        geminiUsageBusy = true
        void refreshGeminiUsage($, now).then(() => redraw($)).catch(() => undefined).finally(() => { geminiUsageBusy = false })
      }
      agents = await $.agent.list().catch(() => agents)
      refreshAgents()
    }
    await refreshCodex($, now).catch(() => undefined)
    redraw($)
    await checkLimits($).catch(() => undefined)
  } finally {
    sampling = false
  }
}

import { contextoTurno } from './turno'

const COMMANDS = ['team-band', 'estado'] as const

// Claude Code's own `language` setting, from `$.config.list()` (row with key «language»).
async function configLanguage($: EngineInterface): Promise<string | undefined> {
  const rows: unknown = await $.config.list()
  const list: unknown[] = Array.isArray(rows) ? rows
    : rows && typeof rows === 'object' ? Object.entries(rows).map(([key, value]) => ({ key, value })) : []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const { key, name, value } = row as { key?: unknown; name?: unknown; value?: unknown }
    if ((key ?? name) === 'language' && typeof value === 'string') return value
  }
  return undefined
}

const startsSpanish = (value: string | undefined) => !!value && value.trim().toLowerCase().startsWith('es')

/** auto: Claude Code setting, then LC_ALL / LC_MESSAGES / LANG, then the Windows culture. Anything else: English. */
async function detectLang($: EngineInterface): Promise<Lang> {
  try {
    const setting = (await configLanguage($).catch(() => undefined))?.trim().toLowerCase()
    if (setting && (setting.startsWith('es') || setting.includes('spanish') || setting.includes('español'))) return 'es'
    // The engine wants literal names in $.env.get.
    if (startsSpanish(await $.env.get('LC_ALL').catch(() => undefined))) return 'es'
    if (startsSpanish(await $.env.get('LC_MESSAGES').catch(() => undefined))) return 'es'
    if (startsSpanish(await $.env.get('LANG').catch(() => undefined))) return 'es'
    const os = await $.env.get('OS').catch(() => undefined)
    if (/windows/i.test(os ?? '')) {
      const culture = await sh($, ['powershell', '-NoProfile', '-Command', '(Get-Culture).Name'], 4000)
      if (startsSpanish(culture)) return 'es'
    }
  } catch {
    // Any failure while detecting: English.
  }
  return 'en'
}

export const register: Register = (on, options) => {
  // Opción `language` del plugin: auto (por defecto), en o es.
  const forced = (options as unknown as { language?: unknown } | undefined)?.language

  // Cada mensaje del usuario lleva, solo para el modelo, el estado de los tres y a quién darle trabajo.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !live.now) return next(e)
    return next({ ...e, context: [...(e.context ?? []), contextoTurno(live)] })
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = { limits: [], now: 0 }
    mainTurn = newest = undefined
    probeAt = codexScanAt = codexPollAt = geminiUsageAt = -Infinity
    platform = undefined
    agents = []
    agentLoops.clear()
    rollouts.clear()
    geminiLogs.clear()
    $.ui.status(undefined)
    live.lang = isLang(forced) ? forced : await detectLang($).catch((): Lang => 'en')
    enabled = await $.store.get(STORE_KEY).catch(() => undefined) !== false
    await $.command.register({ name: 'team-band', description: t(live.lang, 'cmd.description'), immediate: true })
    await $.command.register({ name: 'estado', description: t(live.lang, 'cmd.aliasDescription'), immediate: true })
    $.clock.every(TICK_MS, () => void sample($).catch(() => undefined))
    await sample($).catch(() => undefined)
    return started
  })

  // /team-band and its Spanish alias /estado both toggle the band.
  for (const command of COMMANDS) {
    on('command.run', { command }, async $ => {
      enabled = !enabled
      redraw($)
      await $.store.set(STORE_KEY, enabled)
      return { text: t(live.lang, enabled ? 'cmd.shown' : 'cmd.hidden') }
    })
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      views.delete(e.surface)
      return next(e)
    }
    const columns = e.props.bodyColumns
    const rows = enabled ? bandRows(live, columns) : []
    views.set(e.surface, { columns, signature: JSON.stringify(rows) })
    if (!rows.length) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const band = (
      <Box flexDirection="column">
        {rows.map((row, index) => (
          <Text key={String(index)} mono wrap="truncate-end" maxLines={1}>
            {row.map(({ text, color, bold, dim }, i) => (
              <Text key={String(i)} color={color} weight={bold ? 'bold' : undefined} dimColor={dim}>{text}</Text>
            ))}
          </Text>
        ))}
      </Box>
    )
    const below = await next(e)
    return below ? <Box flexDirection="column">{band}{below}</Box> : band
  })

  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    if (agentId === undefined) {
      mainTurn = e.turnId
      live.working = true
      live.model = e.model
    } else {
      agentLoops.set(agentId, { model: e.model, turnId: e.turnId })
      refreshAgents()
    }
    redraw($)
    const at = agentId === undefined ? await $.clock.now().catch(() => live.now) : undefined
    const result = yield* next(e)
    if (result?.usage) {
      if (at !== undefined) {
        live.now = Math.max(live.now, at)
        live.lastRequestAt = Math.max(at, live.lastRequestAt ?? at)
        redraw($)
      }
      const id = await $.session.id().catch(() => undefined)
      if (id) {
        const count = tokensOf(result.usage)
        tokenWrites = tokenWrites.then(async () => {
          const key = `tokens:${id}`
          const saved = await $.store.get(key)
          const total = typeof saved === 'number' && Number.isFinite(saved) ? saved : 0
          await $.store.set(key, total + count)
        }).catch(() => undefined)
        await tokenWrites
      }
    }
    return result
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      if (mainTurn === e.turnId) {
        mainTurn = undefined
        live.working = false
      }
    } else {
      const loop = agentLoops.get(e.agentId)
      if (loop?.turnId === e.turnId) loop.turnId = undefined
      refreshAgents()
    }
    redraw($)
    return next(e)
  })
}
