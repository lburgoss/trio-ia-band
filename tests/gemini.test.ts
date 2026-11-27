import { expect, test } from 'claude-code/testing'
import { bandRows } from '../hooks/band'
import { geminiModelName, parseGeminiUsage, geminiWindow, goDuration, parseGeminiLog, yearOfLog } from '../hooks/gemini'
import type { BandData } from '../types'

const LOG = [
  'I1126 19:21:50.654563       1 printmode.go:209] Print mode: starting (promptLength=603, model="", conversationID="")',
  'I1126 19:21:52.609587       1 model_config_manager.go:375] Propagating selected model override to backend: label="Gemini 4 Neon (High)"',
  'I1126 19:25:33.000000      81 server.go:1883] Sending user message to conversation abc',
  'I1126 19:26:48.758869    3292 retry.go:62] CallWithRetry: attempt 2 failed (transport error (ResourceExhausted, HTTP 429): You have exhausted your capacity on this model. Your quota will reset after 1h2m3s.: RESOURCE_EXHAUSTED',
  'línea sin hora',
].join('\n')
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 26, h, m, s).getTime()
const line = (row: { text: string }[] = []) => row.map(s => s.text).join('')
const geminiRow = (d: BandData, columns = 180) => bandRows(d, columns).find(row => row[0]?.text === 'GEMINI') ?? []

test('lee del registro de agy el modelo, las consultas y el corte 429', () => {
  expect(yearOfLog('cli-20261126_192532.log')).toBe(2026)
  expect(yearOfLog('cli.log')).toBe(undefined)
  expect(goDuration('2s')).toBe(2000)
  expect(goDuration('1h2m3s')).toBe(3723_000)
  expect(goDuration('800ms')).toBe(800)
  const log = parseGeminiLog(LOG, 2026)
  expect(log.model?.value).toBe('Gemini 4 Neon (High)')
  expect(log.requests).toEqual([at(19, 25, 33)])
  expect(log.limit?.resetsAt).toBe(at(19, 26, 48) + 3723_000)
  expect(geminiModelName('Gemini 4 Neon (High)')).toBe('4 Neon High')
  expect(geminiModelName(undefined)).toBe('Antigravity')
})

test('estima la ventana de 5 h desde la primera consulta tras una ventana vencida', () => {
  const reqs = [at(8, 0), at(9, 0), at(14, 30), at(15, 0)]
  expect(geminiWindow(reqs, at(16, 0))).toEqual({ resetsAt: at(19, 30), count: 2 })
  expect(geminiWindow(reqs, at(20, 0))).toEqual({ count: 0 })
  expect(geminiWindow([], at(20, 0))).toEqual({ count: 0 })
})

test('muestra modelo, reinicio estimado o real, consultas y última consulta', () => {
  const now = at(16, 0)
  const base: BandData = { now, limits: [], lang: 'es', geminiModel: 'Gemini 4 Neon (High)', geminiToday: 4, geminiLastAt: now - 4 * 60_000 }
  const estimado = line(geminiRow({ ...base, geminiResetsAt: at(19, 30), geminiWindowCount: 2 }))
  expect(estimado).toContain('4 Neon High')
  expect(estimado).toContain('↻ ≈3h30 · 2 en ventana')
  expect(estimado).toContain('Hoy 4 consultas')
  expect(estimado).toContain('Última hace 4 min')
  const cortado = geminiRow({ ...base, geminiResetsAt: now + 42 * 60_000, geminiLimited: true })
  expect(cortado.find(s => s.text.startsWith('Límite'))).toEqual({ text: 'Límite ↻ 42min', color: '#F85149', bold: true })
  expect(line(geminiRow(base))).toContain('5 h    libre')
  for (let columns = 1; columns <= 180; columns++) {
    expect(bandRows({ ...base, geminiResetsAt: at(19, 30), geminiWindowCount: 2 }, columns).every(row => line(row).length <= columns)).toBe(true)
  }
  // Without a language the same row is in English.
  const english: BandData = { ...base }
  delete english.lang
  const estimated = line(geminiRow({ ...english, geminiResetsAt: at(19, 30), geminiWindowCount: 2 }))
  expect(estimated).toContain('↻ ≈3h30 · 2 in window')
  expect(estimated).toContain('Today 4 queries')
  expect(estimated).toContain('Last   4 min ago')
  const limited = geminiRow({ ...english, geminiResetsAt: now + 42 * 60_000, geminiLimited: true })
  expect(limited.find(s => s.text.startsWith('Limit'))).toEqual({ text: 'Limit ↻ 42min', color: '#F85149', bold: true })
})

const USAGE = JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', buckets: [
    { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.9858, reset_time: '2026-12-04T00:19:43Z' },
    { id: 'gemini-5h', window: '5h', remaining_fraction: 0.9434, reset_time: '2026-11-27T05:19:43Z' },
  ] },
  { name: 'Claude and GPT models', buckets: [{ id: '3p-5h', window: '5h', remaining_fraction: 1, reset_time: '1970-01-01T00:00:00Z' }] },
] } } })

test('lee la cuota real de agy /usage y la pinta como Claude y Codex', () => {
  const now = Date.parse('2026-11-27T00:50:00Z')
  const limits = parseGeminiUsage(USAGE, now)!
  expect(Math.round(limits.five!.used)).toBe(6)
  expect(Math.round(limits.week!.used)).toBe(1)
  expect(limits.five!.resetsAt).toBe(Date.parse('2026-11-27T05:19:43Z'))
  expect(parseGeminiUsage('Error: You are not logged into Antigravity.', now)).toBe(undefined)
  const row = line(geminiRow({ now, limits: [], lang: 'es', geminiLimits: limits }))
  expect(row).toContain('6 %')
  expect(row).toContain('Semana')
  expect(row).toContain('↻ 4h30')
  expect(row).not.toContain('libre')
})
