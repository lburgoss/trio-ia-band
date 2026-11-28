import { expect, test } from 'claude-code/testing'
import { agentLabel, agentMember, bandRows, memberStates } from '../hooks/band'
import type { BandData } from '../types'

const now = new Date(2030, 0, 7, 5, 50).getTime()
const data = (used = 62, codexUsed = 5): BandData => ({
  now, model: 'claude-opus-5-5', codexModel: 'gpt-5.5', codexToday: 540_000, lang: 'es',
  limits: [
    { kind: 'five_hour', percentUsed: used, resetsAt: new Date(now + 130 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(now + 7 * 864e5 + 130 * 60_000).toISOString() },
  ],
  codex: { five: { used: codexUsed, at: now }, week: { used: 10, at: now } },
})
const line = (row: ReturnType<typeof bandRows>[number] = []) => row.map(s => s.text).join('')
// Same data without a language: the band must fall back to English.
const english = (): BandData => {
  const d = data()
  delete d.lang
  return d
}

test('colorea las barras de uso y saldo en los umbrales exactos', () => {
  // Both teams fill the same way: the share used, with the same thresholds.
  for (const [used, color] of [
    [69, '#3FB950'],
    [70, '#D29922'],
    [89, '#D29922'],
    [90, '#F85149'],
  ] as const) {
    const [claude = [], codex = []] = bandRows(data(used, used), 180)
    expect(claude.find(s => s.text.startsWith('█'))?.color).toBe(color)
    expect(codex.find(s => s.text.startsWith('█'))?.color).toBe(color)
    expect(line(codex)).toContain(`${used} %`)
    expect(line(codex)).not.toContain('quedan')
  }
  const [claude = [], codex = []] = bandRows(data(), 180)
  expect(claude[0]).toEqual({ text: 'CLAUDE', bold: true, color: '#3FB950' })
  expect(line(claude)).toContain('███████░░░░░  62 %')
  expect(line(claude)).toContain('↻ 2h10')
  expect(line(claude)).toMatch(/Semana .*↻ \d+d\d+h/)
  expect(line(claude)).not.toContain('reinicia')
  expect(line(codex)).toContain('█░░░░░░░░░░░   5 %')
  expect(line(codex)).toContain('GPT-5.5')
  expect(line(codex)).toContain('540 k tokens')
})

test('muestra los estados de caché y aplica el TTL corto sin ambos límites disponibles', () => {
  const cache = (d: BandData) => bandRows(d, 180)[0]?.at(-1)
  expect(cache(data())).toEqual({ text: '—', dim: true })
  expect(cache({ ...data(), lastRequestAt: now - 12 * 60_000 })).toEqual({ text: '48 min', color: '#3FB950' })
  expect(cache({ ...data(), lastRequestAt: now - 50 * 60_000 })).toEqual({ text: '10 min', color: '#D29922' })
  expect(cache({ ...data(), lastRequestAt: now - 54 * 60_000 })).toEqual({ text: '6 min', color: '#D29922' })
  expect(cache({ ...data(100), lastRequestAt: now })).toEqual({ text: '5 min', color: '#D29922' })
  expect(cache({ ...data(), limits: [], lastRequestAt: now - 5 * 60_000 })).toEqual({ text: 'vencida', color: '#F85149' })
})

test('agrupa agentes y reduce filas sin superar el ancho disponible', () => {
  const d = {
    ...data(),
    agents: [{ model: 'claude-haiku-5-5', working: true }, { model: 'claude-haiku-5-5', working: false }],
    sys: { memUsed: 62, memTotal: 100, claude: { count: 1, bytes: 1.1 * 1024 ** 3 }, codex: { count: 1, bytes: 640 * 1024 ** 2 } },
  }
  const active = line(bandRows(d, 180).find(row => row[0]?.text === 'Activos') ?? [])
  expect(active).toContain('● Opus 5.5  ● Haiku 5.5 ×2')
  expect(active.endsWith('RAM 62 %  Claude 1,1 GB  Codex 640 MB')).toBe(true)
  const narrow = bandRows(d, 63).map(line)
  expect(narrow).toHaveLength(5)
  expect(narrow[4]).toContain('Turno')
  expect(narrow[2]).toContain('AGY')
  expect(narrow[3]).toContain('AGY-O')
  expect(narrow[0]).toContain('5 h')
  expect(narrow[0]).not.toContain('Semana')
  expect(narrow[1]).toContain('5 %')
  for (let columns = 1; columns <= 180; columns++) {
    expect(bandRows(d, columns).every(row => line(row).length <= columns)).toBe(true)
  }
  expect(line(bandRows({ limits: [], now, lang: 'es' }, 80)[1] ?? [])).toContain('sin datos todavía')
})

test('distingue un Codex activo, abierto o inactivo aunque aún falten lecturas', () => {
  const status = (d: BandData) => bandRows(d, 180)[1]?.find(s => s.text === '●' || s.text === '○')
  const d = { now, limits: [], sys: { codex: { count: 1, bytes: 1024 } } }
  expect(status({ ...d, agents: [{ type: 'codex:codex-rescue', working: true }] })).toEqual({ text: '●', color: '#3FB950' })
  expect(status({ ...d, codexModifiedAt: now, agents: [{ type: 'codex:codex-rescue', working: false }] })).toEqual({ text: '●', color: '#8B949E' })
  expect(status({ now, limits: [] })).toEqual({ text: '○', color: '#8B949E' })
})

test('muestra la fila AGY en verde mientras trabaja y las consultas de hoy', () => {
  const activo = bandRows({ ...data(), agents: [{ type: 'gemini', working: true }], geminiToday: 3 }, 180)
  const gemini = activo[2] ?? []
  expect(gemini[0]).toEqual({ text: 'AGY   ', bold: true, color: '#3FB950' })
  expect(gemini.find(s => s.text === '●')?.color).toBe('#3FB950')
  expect(line(gemini)).toContain('Antigravity')
  expect(line(gemini)).toContain('Hoy 3 consultas')
  const quieto = bandRows({ ...data(), geminiModifiedAt: now - 120_000, geminiToday: 0 }, 180)
  const fila = quieto[2] ?? []
  expect(fila.find(s => s.text === '○')?.color).toBe('#8B949E')
  expect(line(fila)).toContain('sin uso hoy')
})

test('lista cada subagente con su modelo, su tarea y el puente a Gemini o Codex', () => {
  const d = {
    ...data(),
    geminiModel: 'Gemini 4 Neon (High)',
    codexModel: 'gpt-5.5',
    agents: [
      { model: 'claude-sonnet-5-5', working: true, task: 'Revisión de diseño', type: 'general-purpose' },
      { model: 'claude-haiku-5-5', working: true, task: 'Leer video', type: 'gemini' },
      { model: 'claude-sonnet-5-5', working: false, task: 'Arreglar tablero', type: 'codex:codex-rescue' },
    ],
  }
  const rows = bandRows(d, 180).map(line).filter(l => l.startsWith('2º plano'))
  expect(rows).toHaveLength(3)
  expect(rows[0]).toContain('● Sonnet 5.5  Revisión de diseño')
  expect(rows[1]).toContain('AGY 4 Neon High (vía Haiku 5.5)')
  expect(rows[2]).toContain('Codex GPT-5.5 (vía Sonnet 5.5)')
  const many = { ...d, agents: [...d.agents, ...d.agents] }
  expect(bandRows(many, 180).map(line).at(-1)).toContain('+3 más')
  for (let columns = 1; columns <= 180; columns++) {
    expect(bandRows(many, columns).every(row => line(row).length <= columns)).toBe(true)
  }
})

test('habla inglés por defecto, con punto decimal, sin pasarse del ancho', () => {
  const d: BandData = {
    ...english(),
    lastRequestAt: now - 70 * 60_000,
    geminiToday: 1,
    geminiLastAt: now - 4 * 60_000,
    agents: [
      { model: 'claude-sonnet-5-5', working: true, task: 'Design review', type: 'general-purpose' },
      { model: 'claude-haiku-5-5', working: false, task: 'Read video', type: 'gemini' },
    ],
    sys: { memUsed: 62, memTotal: 100, claude: { count: 1, bytes: 1.1 * 1024 ** 3 } },
  }
  const rows = bandRows(d, 180).map(line)
  expect(rows[0]).toMatch(/Week .*↻ \d+d\d+h/)
  expect(rows[0]).toMatch(/Cache\s+expired$/)
  expect(rows[1]).toContain('Today  540 k tokens')
  expect(rows[2]).toContain('5 h    free')
  expect(rows[2]).toContain('Today 1 query')
  expect(rows[2]).toContain('Last   4 min ago')
  expect(rows.find(row => row.startsWith('Active'))).toContain('Claude 1.1 GB')
  expect(rows.find(row => row.startsWith('Turn '))).toContain('· Claude: delegate all')
  const background = rows.filter(row => row.startsWith('Background '))
  expect(background).toHaveLength(2)
  expect(background[0]).toContain('● Sonnet 5.5  Design review')
  expect(background[1]).toContain('AGY Antigravity (via Haiku 5.5)')
  expect(rows.join('\n')).not.toMatch(/Semana|Caché|Hoy|Última|Activos|Turno|2º plano|vía|vencida/)
  expect(line(bandRows({ ...d, codexToday: 1_234_567 }, 180)[1])).toContain('1.2 M tokens')
  expect(line(bandRows({ ...d, codexToday: 1_234_567, lang: 'es' }, 180)[1])).toContain('1,2 M tokens')
  expect(line(bandRows({ limits: [], now }, 80)[1])).toContain('no data yet')
  const many = { ...d, agents: [...d.agents!, ...d.agents!, ...d.agents!] }
  expect(bandRows(many, 180).map(line).at(-1)).toBe('Background +3 more')
  for (let columns = 1; columns <= 180; columns++) {
    expect(bandRows(many, columns).every(row => line(row).length <= columns)).toBe(true)
  }
})

test('alinea las cuotas de las cuatro filas y pinta AGY-O en azul', () => {
  const d: BandData = {
    ...data(), geminiModel: 'Gemini 4 Neon (High)', geminiModelAt: now - 31_000,
    geminiModifiedAt: now - 1_000, sociosModelAt: now - 29_999, sociosModel: 'Opus 5.5 High',
    geminiLimits: { five: { used: 8.1, at: now }, week: { used: 2.03, at: now } },
    sociosLimits: { five: { used: 93.71, at: now, resetsAt: now + 10 * 60_000 }, week: { used: 46.86, at: now } },
    geminiModels: ['4 Neon', '4 Carbon', '4 Argon', '4 Hydrogen', '3.8 Flash'],
    sociosModels: ['Opus 5.5', 'Sonnet 5.5', 'GPT-OSS 120B'],
  }
  const rows = bandRows(d, 180).slice(0, 4)
  const socios = rows[3] ?? []
  expect(socios.slice(0, 2)).toEqual([
    { text: 'AGY-O', color: '#4285F4', bold: true },
    { text: ' ' },
  ])
  expect(socios.find(s => s.text === '○')?.color).toBe('#8B949E')
  expect(line(socios)).toContain('94 %')
  expect(line(socios)).toContain('47 %')
  for (const [lang, week] of [['en', 'Week'], ['es', 'Semana']] as const) {
    const localized = bandRows({ ...d, lang }, 180).slice(0, 4).map(line)
    expect(localized.map(row => row.slice(0, 6).trimEnd())).toEqual(['CLAUDE', 'CODEX', 'AGY', 'AGY-O'])
    for (const title of ['5 h', week]) {
      const offsets = localized.map(row => row.indexOf(title))
      expect(offsets[0]! > 0).toBe(true)
      expect(offsets).toEqual(Array(4).fill(offsets[0]))
    }
  }
  expect(rows[2]?.at(-1)).toEqual({ text: d.geminiModels!.join('·'), dim: true })
  expect(socios.at(-1)).toEqual({ text: d.sociosModels!.join('·'), dim: true })
  expect(bandRows(d, 125)[2]?.at(-1)?.text.endsWith('…')).toBe(true)
  expect(line(bandRows({ ...d, sociosLimits: undefined, sociosModel: undefined }, 180)[3])).toContain('—             sin datos todavía')
  const bridge = { type: 'gemini', model: 'claude-haiku-5-5', working: true }
  expect(agentLabel({ ...bridge, task: 'Run agy --model claude-opus-5-5' }, d)).toBe('AGY-O claude-opus-5-5 (vía Haiku 5.5)')
  expect(agentLabel(bridge, { ...d, geminiModelAt: now })).toBe('AGY 4 Neon High (vía Haiku 5.5)')
  for (let columns = 6; columns <= 180; columns++) {
    const compact = bandRows(d, columns)
    expect(compact.length >= 4).toBe(true)
    expect(compact.every(row => line(row).length <= columns)).toBe(true)
  }
})

test('mapea cada subagente al miembro de la banda que ejecuta el trabajo', () => {
  expect(agentMember({ type: 'codex:codex-rescue', working: true })).toBe('Codex')
  expect(agentMember({ type: 'gemini', working: true })).toBe('AGY')
  expect(agentMember({ type: 'gemini', working: true, task: 'Programar --model claude-opus-5-5' })).toBe('AGY-O')
  expect(agentMember({ type: 'gemini', working: true, task: 'Revisar --model=gpt-oss-120b' })).toBe('AGY-O')
  expect(agentMember({ type: 'gemini:gemini', working: true, task: 'Run agy --model="gpt-oss-120b"' })).toBe('AGY-O')
  expect(agentMember({ type: 'gemini', working: true, task: 'Leer --model gemini-4-neon' })).toBe('AGY')
  expect(agentMember({ type: 'codex-review', working: true })).toBe('Codex')
  expect(agentMember({ type: 'general-purpose', model: 'claude-sonnet-5-5', working: true })).toBe('Claude')
})

test('aplica los tres estados visuales por fila: sin cupo, trabajando y disponible', () => {
  // Sin cupo prevalece sobre trabajando (nunca verde), mientras las barras conservan sus umbrales.
  const agotado: BandData = {
    ...data(62, 5),
    working: false,
    codexModel: 'gpt-5.5',
    geminiModel: 'Gemini 4 Neon (High)',
    sociosModel: 'Opus 5.5 High',
    geminiModifiedAt: now - 1_000,
    sociosModelAt: now - 1_000,
    geminiLimits: { five: { used: 10, at: now }, week: { used: 5, at: now } },
    sociosLimits: { five: { used: 100, at: now, resetsAt: now + 15 * 60_000 }, week: { used: 47, at: now } },
    agents: [
      { type: 'codex:codex-rescue', model: 'claude-sonnet-5-5', working: true, task: 'Arreglar pruebas' },
      { type: 'gemini', model: 'claude-haiku-5-5', working: true, task: 'Revisar --model claude-opus-5-5' },
    ],
  }
  expect(memberStates(agotado)).toEqual({ Claude: 'working', Codex: 'working', AGY: 'available', 'AGY-O': 'noQuota' })

  const rows = bandRows(agotado, 180)
  const [claude = [], codex = [], agy = [], agyO = []] = rows

  // Claude (sesión activa con cupo): trabajando en verde.
  expect(claude[0]).toEqual({ text: 'CLAUDE', color: '#3FB950', bold: true })
  expect(claude.find(s => s.text === '●')?.color).toBe('#3FB950')
  expect(line(claude)).toContain('● trabajando')
  expect(claude.find(s => s.text.startsWith('Opus 5.5'))?.color).toBe('#3FB950')

  // Codex (subagente en marcha sin escritura reciente en disco): trabajando en verde.
  expect(codex[0]).toEqual({ text: 'CODEX ', color: '#3FB950', bold: true })
  expect(codex.find(s => s.text === '●')?.color).toBe('#3FB950')
  expect(codex.find(s => s.text.startsWith('GPT-5.5'))?.color).toBe('#3FB950')

  // AGY (con cupo y sin trabajo): disponible, color normal (ni verde ni gris oscuro apagado).
  expect(agy[0]).toEqual({ text: 'AGY   ', color: '#4285F4', bold: true })
  expect(agy.find(s => s.text === '○')?.color).toBe('#8B949E')
  const agyModel = agy.find(s => s.text.startsWith('4 Neon High'))
  expect(agyModel?.color).toBe(undefined)
  expect(agyModel?.dim).toBe(undefined)

  // AGY-O (5 h al 100 %): sin cupo en gris oscuro atenuado con ⏸ y «sin cupo», nunca verde;
  // las barras siguen en rojo (100 %) y verde (47 %).
  expect(agyO[0]).toEqual({ text: 'AGY-O', color: '#484F58', dim: true })
  expect(agyO.find(s => s.text === '⏸')).toEqual({ text: '⏸', color: '#484F58', dim: true })
  const sociosModel = agyO.find(s => s.text.startsWith('Opus 5.5'))
  expect(sociosModel?.color).toBe('#484F58')
  expect(sociosModel?.dim).toBe(true)
  expect(line(agyO)).toContain('sin cupo')
  expect(agyO.some(s => s.color === '#3FB950' && !s.text.startsWith('█'))).toBe(false)
  const sociosBars = agyO.filter(s => s.text.startsWith('█'))
  expect(sociosBars[0]?.color).toBe('#F85149')
  expect(sociosBars[1]?.color).toBe('#3FB950')

  // En Activos y 2º plano, Codex sale en verde y el subagente de AGY-O sin cupo sale en gris oscuro.
  const active = rows.find(row => row[0]?.text === 'Activos') ?? []
  expect(active.find(s => s.text === ' Codex')?.color).toBe('#3FB950')
  expect(active.find(s => s.text === ' AGY-O')).toEqual({ text: ' AGY-O', color: '#484F58', dim: true })
  const bg = rows.filter(row => row[0]?.text === '2º plano ')
  expect(bg[0]?.[1]).toEqual({ text: '●', color: '#3FB950' })
  expect(bg[1]?.[1]).toEqual({ text: '⏸', color: '#484F58', dim: true })

  // Semana ≥ 95 % también apaga la fila y la etiqueta en inglés dice «no quota».
  const weekOut: BandData = {
    now, lang: 'en', limits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 95 }],
    model: 'claude-opus-5-5', working: true,
    agents: [{ type: 'gemini', working: true, task: 'Read docs' }],
    geminiLimits: { five: { used: 10, at: now }, week: { used: 10, at: now } },
  }
  expect(memberStates(weekOut)).toEqual({ Claude: 'noQuota', Codex: 'available', AGY: 'working', 'AGY-O': 'available' })
  const [claudeOut = [], , agyWork = []] = bandRows(weekOut, 180)
  expect(claudeOut[0]).toEqual({ text: 'CLAUDE', color: '#484F58', dim: true })
  expect(claudeOut.find(s => s.text === '⏸')).toEqual({ text: '⏸', color: '#484F58', dim: true })
  expect(line(claudeOut)).toContain('no quota')
  expect(line(agyWork)).toContain('● working')
  expect(agyWork.find(s => s.text === '●')?.color).toBe('#3FB950')

  // Claude sin sesión activa ni trabajo queda disponible (color normal, no gris oscuro).
  expect(memberStates({ now, limits: [{ kind: 'five_hour', percentUsed: 20 }] }).Claude).toBe('available')

  // Las columnas de cuota siguen alineadas y caben en cualquier ancho.
  expect(memberStates({ now, limits: [], sessionActive: true }).Claude).toBe('working')
  // En la reserva de coordinación (75 %) Claude sigue trabajando; solo se apaga al quedarse sin cupo.
  expect(memberStates(data(75)).Claude).toBe('working')
  expect(memberStates(data(95)).Claude).toBe('noQuota')
  const sociosAvailable = { ...agotado, sociosLimits: { five: { used: 20, at: now } } }
  expect(memberStates(sociosAvailable)['AGY-O']).toBe('working')
  expect(line(bandRows(sociosAvailable, 180)[3])).toContain('● trabajando')
  expect(memberStates({ ...weekOut, geminiLimited: true }).AGY).toBe('noQuota')
  expect(line(bandRows(agotado, 40)[3])).toContain('sin cupo')
  const aligned = bandRows(agotado, 180).slice(0, 4).map(line)
  for (const title of ['5 h', 'Semana']) {
    const offsets = aligned.map(row => row.indexOf(title))
    expect(offsets[0]! > 0).toBe(true)
    expect(offsets).toEqual(Array(4).fill(offsets[0]))
  }
  for (let columns = 6; columns <= 180; columns++) {
    expect(bandRows(agotado, columns).every(row => line(row).length <= columns)).toBe(true)
  }
})
