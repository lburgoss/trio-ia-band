import { expect, test } from 'claude-code/testing'
import { turno, contextoTurno } from '../hooks/turno'
import type { BandData } from '../types'

const now = Date.parse('2026-11-26T22:00:00Z')
const base = (claude: number, codex: number, gemini: number, geminiResetMin = 200): BandData => ({
  now,
  limits: [{ kind: 'five_hour', percentUsed: claude, resetsAt: new Date(now + 120 * 60_000).toISOString() }],
  codex: { five: { used: codex, resetsAt: now + 180 * 60_000, at: now } },
  geminiLimits: { five: { used: gemini, resetsAt: now + geminiResetMin * 60_000, at: now } },
})

test('Claude al 80 % pasa a reserva y sale del reparto', () => {
  const t = turno(base(80, 10, 10))
  expect(t.zonaClaude).toBe('reserva')
  expect(t.orden).not.toContain('Claude')
})

test('el cupo que vence pronto va primero', () => {
  const t = turno(base(20, 30, 40, 15))
  expect(t.orden[0]).toBe('Gemini')
  expect(contextoTurno({ ...base(20, 30, 40, 15), lang: 'es' })).toContain('cupo por vencer')
})

test('el bloque de turno sale en inglés por defecto y en español con lang es', () => {
  const en = contextoTurno(base(20, 30, 40, 15))
  expect(en.split('\n')[0]).toBe('Team status (trio-ia-band mod; automatic data, not a user message):')
  expect(en).toContain('Gemini: 5 h 40 % used · resets in 15 min · score 105 (quota about to reset: use it first)')
  expect(en).toContain('Priority for new work now: Gemini > Codex > Claude.')
  expect(en).toContain('Claude < 50 %: normal split')
  expect(en).not.toMatch(/Estado del equipo|Prioridad|puntaje|usado/)
  const es = contextoTurno({ ...base(20, 30, 40, 15), lang: 'es' })
  expect(es.split('\n')[0]).toContain('Estado del equipo')
  expect(es).toContain('Claude: 5 h 20 % usado · se renueva en 2 h 0 min')
  expect(es).toContain('Prioridad para dar trabajo ahora: Gemini > Codex > Claude.')
  expect(contextoTurno({ ...base(99, 99, 99), geminiLimited: true })).toContain('nobody has quota: tell the user')
})

test('un corte de Gemini lo saca del reparto', () => {
  const t = turno({ ...base(20, 30, 10), geminiLimited: true })
  expect(t.orden).not.toContain('Gemini')
})
