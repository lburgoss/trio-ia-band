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
  expect(contextoTurno(base(20, 30, 40, 15))).toContain('cupo por vencer')
})

test('un corte de Gemini lo saca del reparto', () => {
  const t = turno({ ...base(20, 30, 10), geminiLimited: true })
  expect(t.orden).not.toContain('Gemini')
})
