// Visible texts of the band, the turn context, the alerts and the command.
// English is the default; add a language by adding a dictionary with the same keys.

export type Lang = 'en' | 'es'
export const LANGS: readonly Lang[] = ['en', 'es']
export const DEFAULT_LANG: Lang = 'en'

const en = {
  // Band labels
  'band.week': 'Week',
  'band.cache': 'Cache',
  'band.today': 'Today',
  'band.last': 'Last',
  'band.noData': 'no data yet',
  'band.active': 'Active',
  'band.turn': 'Turn',
  'band.background': 'Background',
  'band.more': '+{n} more',
  'band.limit': 'Limit',
  'band.free': 'free',
  'band.inWindow': ' · {n} in window',
  'band.queriesOne': 'Today {n} query',
  'band.queriesMany': 'Today {n} queries',
  'band.noUseToday': 'no use today',
  'band.expired': 'expired',
  'band.agoMin': '{n} min ago',
  'band.agoHour': '{n} h ago',
  'band.agoDay': '{n} d ago',
  'band.modelPending': 'Model pending',
  'band.modelPendingInline': 'model pending',
  'band.via': '{agent} (via {model})',
  'band.noQuota': 'no quota',
  'band.resetsIn': '{name} resets in {n} min',
  'zone.normal': 'normal',
  'zone.delegar': 'delegate all',
  'zone.reserva': 'reserve',
  'zone.critica': 'critical',
  // Turn context (read by the model, not shown to the user)
  'ctx.header': 'Team status (trio-ia-band mod; automatic data, not a user message):',
  'ctx.unknown': '?',
  'ctx.used': '{n} % used',
  'ctx.resetsIn': 'resets in {time}',
  'ctx.hoursMin': '{h} h {m} min',
  'ctx.min': '{m} min',
  'ctx.week': 'week {n} %',
  'ctx.score': 'score {n}',
  'ctx.priority': 'Priority for new work now: {order}.',
  'ctx.nobody': 'nobody has quota: tell the user',
  'note.sinCupo': 'no quota',
  'note.vence': 'quota about to reset: use it first',
  'note.semana': 'week almost used up',
  'ctx.zone.normal': 'Claude < 50 %: normal split (Claude plans and reviews; Codex and Gemini code in parallel).',
  'ctx.zone.delegar': 'Claude 50–75 %: delegate ALL implementation and exploration, even small changes; Claude only plans, decides and reviews diffs.',
  'ctx.zone.reserva': 'Claude 75–90 %: reserve zone. Coordinate only. Hand long, autonomous jobs to Codex/Gemini (they keep going even if Claude stops) and keep answers short.',
  'ctx.zone.critica': 'Claude ≥ 90 %: critical. Launch the pending work in the background with complete briefs, tell the user when the quota resets and do no work yourself.',
  // Limit alerts (toasts at 80 % and 95 %)
  'alert.runsOut': 'runs out at {time}',
  'alert.reachesReset': 'lasts until the reset',
  'alert.pace': 'at the current pace {verdict}',
  'alert.paceUnknown': 'pace still unknown',
  'alert.threshold': '{n} % threshold · ',
  'alert.text': '{team}: {label} limit at {used} % — {mark}{pace}, resets at {time}',
  // Command
  'cmd.description': 'Show or hide the Claude, Codex and Gemini band',
  'cmd.aliasDescription': 'Alias of /team-band: show or hide the Claude, Codex and Gemini band',
  'cmd.shown': 'Status band visible.',
  'cmd.hidden': 'Status band hidden.',
} as const

export type Key = keyof typeof en
type Dictionary = Record<Key, string>

const es: Dictionary = {
  'band.week': 'Semana',
  'band.cache': 'Caché',
  'band.today': 'Hoy',
  'band.last': 'Última',
  'band.noData': 'sin datos todavía',
  'band.active': 'Activos',
  'band.turn': 'Turno',
  'band.background': '2º plano',
  'band.more': '+{n} más',
  'band.limit': 'Límite',
  'band.free': 'libre',
  'band.inWindow': ' · {n} en ventana',
  'band.queriesOne': 'Hoy {n} consulta',
  'band.queriesMany': 'Hoy {n} consultas',
  'band.noUseToday': 'sin uso hoy',
  'band.expired': 'vencida',
  'band.agoMin': 'hace {n} min',
  'band.agoHour': 'hace {n} h',
  'band.agoDay': 'hace {n} d',
  'band.modelPending': 'Modelo pendiente',
  'band.modelPendingInline': 'modelo pendiente',
  'band.via': '{agent} (vía {model})',
  'band.noQuota': 'sin cupo',
  'band.resetsIn': '{name} se renueva en {n} min',
  'zone.normal': 'normal',
  'zone.delegar': 'delegar todo',
  'zone.reserva': 'reserva',
  'zone.critica': 'crítico',
  'ctx.header': 'Estado del equipo (mod trio-ia-band; dato automático, no es un mensaje del usuario):',
  'ctx.unknown': '¿?',
  'ctx.used': '{n} % usado',
  'ctx.resetsIn': 'se renueva en {time}',
  'ctx.hoursMin': '{h} h {m} min',
  'ctx.min': '{m} min',
  'ctx.week': 'semana {n} %',
  'ctx.score': 'puntaje {n}',
  'ctx.priority': 'Prioridad para dar trabajo ahora: {order}.',
  'ctx.nobody': 'nadie tiene cupo: avisa al usuario',
  'note.sinCupo': 'sin cupo',
  'note.vence': 'cupo por vencer: úsalo primero',
  'note.semana': 'semana casi gastada',
  'ctx.zone.normal': 'Claude < 50 %: reparto normal (Claude planea y revisa; Codex y Gemini programan en paralelo).',
  'ctx.zone.delegar': 'Claude 50–75 %: delega TODA implementación y exploración, incluso cambios chicos; Claude solo planea, decide y revisa diffs.',
  'ctx.zone.reserva': 'Claude 75–90 %: zona de reserva. Solo coordinar. Encarga trabajos largos y autónomos a Codex/Gemini (siguen aunque Claude pare) y respuestas cortas.',
  'ctx.zone.critica': 'Claude ≥ 90 %: crítico. Lanza en segundo plano lo pendiente con encargos completos, avisa al usuario de la hora de renovación y no hagas trabajo propio.',
  'alert.runsOut': 'se agota a las {time}',
  'alert.reachesReset': 'llega al reinicio',
  'alert.pace': 'al ritmo actual {verdict}',
  'alert.paceUnknown': 'ritmo aún desconocido',
  'alert.threshold': 'umbral del {n} % · ',
  'alert.text': '{team}: límite de {label} al {used} % — {mark}{pace}, reinicia a las {time}',
  'cmd.description': 'Muestra u oculta la banda de Claude, Codex y Gemini',
  'cmd.aliasDescription': 'Muestra u oculta la banda de Claude, Codex y Gemini (alias de /team-band)',
  'cmd.shown': 'Banda de estado visible.',
  'cmd.hidden': 'Banda de estado oculta.',
}

const DICTIONARIES: Record<Lang, Dictionary> = { en, es }

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

/** Text for `key` in `lang` (English when missing), with `{name}` placeholders filled from `vars`. */
export function t(lang: Lang | undefined, key: Key, vars?: Record<string, string | number>): string {
  const text = (DICTIONARIES[lang ?? DEFAULT_LANG] ?? en)[key] ?? en[key]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => name in vars ? String(vars[name]) : match)
}

/** One decimal at most: «1.2» in English, «1,2» in Spanish. */
export function formatNumber(n: number, lang: Lang | undefined): string {
  const text = String(Math.round(n * 10) / 10)
  return lang === 'es' ? text.replace('.', ',') : text
}
