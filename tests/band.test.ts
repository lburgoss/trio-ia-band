import { expect, test } from 'claude-code/testing'
import { bandRows } from '../hooks/band'
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
  expect(claude[0]).toEqual({ text: 'CLAUDE', bold: true, color: '#D97757' })
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
  expect(narrow).toHaveLength(4)
  expect(narrow[3]).toContain('Turno')
  expect(narrow[2]).toContain('GEMINI')
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
  expect(status({ ...d, codexModifiedAt: now - 29_999 })).toEqual({ text: '●', color: '#3FB950' })
  expect(status({ ...d, codexModifiedAt: now - 30_000 })).toEqual({ text: '●', color: '#8B949E' })
  expect(status({ now, limits: [] })).toEqual({ text: '○', color: '#8B949E' })
})

test('muestra la fila GEMINI en azul con su estado y las consultas de hoy', () => {
  const activo = bandRows({ ...data(), geminiModifiedAt: now - 5_000, geminiToday: 3 }, 180)
  const gemini = activo.find(row => row[0]?.text === 'GEMINI') ?? []
  expect(gemini[0]).toEqual({ text: 'GEMINI', bold: true, color: '#4285F4' })
  expect(gemini.find(s => s.text === '●')?.color).toBe('#3FB950')
  expect(line(gemini)).toContain('Antigravity')
  expect(line(gemini)).toContain('Hoy 3 consultas')
  const quieto = bandRows({ ...data(), geminiModifiedAt: now - 120_000, geminiToday: 0 }, 180)
  const fila = quieto.find(row => row[0]?.text === 'GEMINI') ?? []
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
  expect(rows[1]).toContain('Gemini 4 Neon High (vía Haiku 5.5)')
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
  expect(background[1]).toContain('Gemini Antigravity (via Haiku 5.5)')
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
