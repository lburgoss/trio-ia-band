import { expect, test } from 'claude-code/testing'
import { UMBRAL_SIN_CUPO, contextoTurno, esSinCupo, turno } from '../hooks/turno'
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
  expect(t.orden[0]).toBe('AGY')
  expect(contextoTurno({ ...base(20, 30, 40, 15), lang: 'es' })).toContain('cupo por vencer')
})

test('el bloque de turno sale en inglés por defecto y en español con lang es', () => {
  const en = contextoTurno(base(20, 30, 40, 15))
  expect(en.split('\n')[0]).toBe('Team status (trio-ia-band mod; automatic data, not a user message):')
  expect(en).toContain('AGY (Gemini: reading, media, web): 5 h 40 % used · resets in 15 min · score 105 (quota about to reset: use it first)')
  expect(en).toContain('Priority for new work now: AGY > Codex > Claude > AGY-O.')
  expect(en).toContain('Claude < 50 %: normal split')
  expect(en).not.toMatch(/Estado del equipo|Prioridad|puntaje|usado/)
  const es = contextoTurno({ ...base(20, 30, 40, 15), lang: 'es' })
  expect(es.split('\n')[0]).toContain('Estado del equipo')
  expect(es).toContain('Claude: 5 h 20 % usado · se renueva en 2 h 0 min')
  expect(es).toContain('Prioridad para dar trabajo ahora: AGY > Codex > Claude > AGY-O.')
  expect(contextoTurno({ ...base(99, 99, 99), geminiLimited: true, sociosLimits: { five: { used: 99, at: now } } })).toContain('nobody has quota: tell the user')
})

test('un corte de Gemini lo saca del reparto', () => {
  const t = turno({ ...base(20, 30, 10), geminiLimited: true })
  expect(t.orden).not.toContain('AGY')
})

test('puntúa a AGY-O y avisa al alcanzar el 90 % en cualquiera de sus ventanas', () => {
  const d = base(20, 30, 40)
  const nota = 'AGY-O casi sin cupo: programar con Codex, o con agy sin --model (Gemini).'
  expect(contextoTurno(d)).not.toContain(nota)
  for (const [five, week, score] of [[90, 40, 10], [40, 90, 18]] as const) {
    const data = { ...d, sociosLimits: {
      five: { used: five, at: now, resetsAt: now + 120 * 60_000 },
      week: { used: week, at: now },
    } }
    expect(turno(data).puestos.find(p => p.nombre === 'AGY-O')?.puntaje).toBe(score)
    const context = contextoTurno({ ...data, lang: 'es' })
    expect(context).toContain('AGY (Gemini: lectura, medios, web): 5 h 40 % usado')
    expect(context).toContain(`AGY-O (Opus/Sonnet/GPT: programar y revisar por agy): 5 h ${five} % usado · se renueva en 2 h 0 min · semana ${week} % · puntaje ${score}`)
    expect(context).toContain(nota)
    const en = contextoTurno(data)
    expect(en).toContain('AGY (Gemini: reading, media, web): 5 h 40 % used')
    expect(en).toContain(`AGY-O (Opus/Sonnet/GPT inside agy: coding and reviews): 5 h ${five} % used · resets in 2 h 0 min · week ${week} % · score ${score}`)
    expect(en).toContain('AGY-O almost out of quota: code with Codex, or with agy without --model (Gemini).')
  }
})

test('esSinCupo comparte el criterio exacto de exclusión de turno', () => {
  expect(UMBRAL_SIN_CUPO).toBe(97)
  expect(esSinCupo({ used: 96, at: now }, { used: 96, at: now })).toBe(false)
  expect(esSinCupo(undefined, undefined)).toBe(false)
  expect(esSinCupo({ used: 97, at: now }, undefined)).toBe(true)
  expect(esSinCupo({ used: 100, at: now }, { used: 20, at: now })).toBe(true)
  expect(esSinCupo({ used: 10, at: now }, { used: 97, at: now })).toBe(true)
  expect(esSinCupo({ used: 10, at: now }, { used: 10, at: now }, true)).toBe(true)
  const sinAgyO = turno({ ...base(20, 30, 40), sociosLimits: { five: { used: 100, at: now }, week: { used: 40, at: now } } })
  const agyO = sinAgyO.puestos.find(p => p.nombre === 'AGY-O')
  expect(agyO?.puntaje).toBe(0)
  expect(agyO?.nota).toBe('sinCupo')
  expect(sinAgyO.orden).not.toContain('AGY-O')
})
