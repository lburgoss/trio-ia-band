import { expect, mock, test } from 'claude-code/testing'
import { forecast, LIMIT_STORE, observe, updateLimits, verdictText } from '../hooks/limits'
import type { LimitData } from '../types'

const HOUR = 3600_000
const NOW = Date.UTC(2030, 0, 1, 12)
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

function data(used: number, now: number, reset: number): LimitData {
  return {
    now,
    limits: [{ kind: 'five_hour', percentUsed: used, resetsAt: new Date(reset).toISOString() }],
    codex: { five: { used, at: now, resetsAt: reset } },
  }
}

test('el ritmo medido pronostica los límites de Claude y Codex', () => {
  const reset = NOW + 2 * HOUR
  const initial = updateLimits(data(60, NOW - HOUR, reset), undefined)
  const { forecasts } = updateLimits(data(82, NOW, reset), initial.memory)
  for (const id of ['claude5', 'codex5'] as const) {
    expect(forecasts[id]).toEqual({ rate: 22, etaMs: 18 * HOUR / 22, verdict: 'dry' })
    expect(verdictText(forecasts[id], NOW)).toMatch(/^se agota a las \d\d:\d\d$/)
  }
})

test('una ventana lenta llega al reinicio y una lectura vencida no da pronóstico', () => {
  const reset = NOW + HOUR
  const first = { used: 20, at: NOW - HOUR, resetsAt: reset }
  const latest = { used: 30, at: NOW, resetsAt: reset }
  const memory = observe(observe(undefined, first, 5), latest, 5)
  const safe = forecast(latest, memory, 5, NOW)
  expect(safe).toEqual({ rate: 10, etaMs: 7 * HOUR, verdict: 'safe' })
  expect(verdictText(safe, NOW)).toBe('llega al reinicio')
  expect(forecast(latest, memory, 5, reset)).toEqual({})
  expect(observe(memory, { ...latest, resetsAt: reset + HOUR }, 5).samples).toHaveLength(1)
})

test('cada equipo avisa una vez por ventana, reinicio y umbral', () => {
  const reset = NOW + 2 * HOUR
  let saved = updateLimits(data(79, NOW, reset), undefined).memory
  const toasts: string[] = []
  const read = (used: number, at: number, resetsAt = reset) => {
    const result = updateLimits(data(used, at, resetsAt), JSON.parse(JSON.stringify(saved)))
    saved = result.memory
    toasts.push(...result.alerts)
  }
  read(82, NOW + 1000)
  expect(toasts).toHaveLength(2)
  read(79, NOW + 2000)
  read(82, NOW + 3000)
  expect(toasts).toHaveLength(2)
  read(97, NOW + 4000)
  read(97, NOW + 5000)
  expect(toasts).toHaveLength(4)
  expect(toasts).toContainEqual(expect.stringContaining('Codex: límite de 5 h al 97 % —'))
  expect(toasts).toContainEqual(expect.stringContaining('Claude: límite de 5 h al 82 % —'))
  const weekly = data(97, NOW + 6000, reset)
  weekly.limits.push({ kind: 'seven_day', percentUsed: 82, resetsAt: new Date(reset).toISOString() })
  weekly.codex!.week = { used: 82, at: weekly.now, resetsAt: reset }
  const weekResult = updateLimits(weekly, saved)
  expect(weekResult.alerts).toHaveLength(2)
  expect(weekResult.alerts.every(alert => alert.includes('límite de 7 d'))).toBe(true)
  read(97, reset + 1000, reset + 5 * HOUR)
  expect(toasts).toHaveLength(8)
})

test('el muestreo respeta un aviso guardado y persiste el siguiente antes del toast', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const reset = NOW + HOUR
  let saved = updateLimits(data(82, NOW - 1000, reset), undefined).memory
  let used = 82
  const toasts: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('store.get', ($, e) => ({ value: e.key === LIMIT_STORE ? saved : undefined }))
  on('store.set', ($, e) => {
    if (e.key === LIMIT_STORE) saved = e.value as typeof saved
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    expect(saved.alerts[`claude5:${reset}`]).toEqual([80, 95])
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { tokens: 0, window: 100, percent: 0 }, rateLimits: data(used, NOW, reset).limits },
  }))
  await $.session.start(START)
  expect(toasts).toEqual([])
  used = 96
  await clock.advance(3000)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Claude: límite de 5 h al 96 % —')
})
