import type { BandData, Reading } from '../types'
import { readings } from './limits'
import { t } from './i18n'
import type { Key } from './i18n'

/**
 * Reparto por cupo que vence: a quién conviene darle trabajo ahora.
 * - Claude dirige: se guarda una reserva (RESERVA %) para coordinar y revisar; si se agota, todo se detiene.
 * - El cupo libre que se renueva pronto se pierde si no se usa: suma prioridad.
 * - Una semana casi gastada o un corte (429) bajan o anulan la prioridad.
 */
export type Miembro = 'Claude' | 'Codex' | 'AGY' | 'AGY-O'
/** Nota de cada puesto; el texto visible sale de i18n.ts. */
export type Nota = 'sinCupo' | 'vence' | 'semana'
export type Puesto = {
  nombre: Miembro
  usado?: number          // % usado de la ventana de 5 h
  semana?: number         // % usado de la semana
  renuevaMin?: number     // minutos hasta que se renueva la ventana de 5 h
  libre: number           // % libre aprovechable (Claude: descontada la reserva)
  puntaje: number
  nota?: Nota
}
export type Turno = { puestos: Puesto[]; orden: Miembro[]; zonaClaude: 'normal' | 'delegar' | 'reserva' | 'critica' }

export const RESERVA = 25
const MIN = 60_000

function puesto(nombre: Miembro, cinco: Reading | undefined, semana: Reading | undefined, now: number, cortado = false): Puesto {
  const usado = cinco?.used
  const sem = semana?.used
  const renuevaMin = cinco?.resetsAt !== undefined && cinco.resetsAt > now ? Math.ceil((cinco.resetsAt - now) / MIN) : undefined
  if (cortado || (usado ?? 0) >= 97 || (sem ?? 0) >= 97) {
    return { nombre, usado, semana: sem, renuevaMin, libre: 0, puntaje: 0, nota: 'sinCupo' }
  }
  // Sin lectura: se asume medio cupo, sin bono de vencimiento.
  const bruto = usado === undefined ? 50 : 100 - usado
  const libre = Math.max(0, bruto - (nombre === 'Claude' ? RESERVA : 0))
  // Bono por vencer: hasta ×2 si se renueva en ≤ 60 min (lo libre se pierde al renovarse).
  const vence = renuevaMin !== undefined && renuevaMin <= 60 ? 1 + (60 - renuevaMin) / 60 : 1
  const freno = sem !== undefined && sem >= 85 ? 0.3 : 1
  const nota: Nota | undefined = renuevaMin !== undefined && renuevaMin <= 30 && libre >= 10 ? 'vence'
    : freno < 1 ? 'semana' : undefined
  return { nombre, usado, semana: sem, renuevaMin, libre, puntaje: Math.round(libre * vence * freno), nota }
}

export function turno(data: BandData): Turno {
  const { claude5, claude7, codex5, codex7 } = readings(data)
  const g = data.geminiLimits ?? {}
  const s = data.sociosLimits ?? {}
  const puestos = [
    puesto('Claude', claude5, claude7, data.now),
    puesto('Codex', codex5, codex7, data.now),
    puesto('AGY', g.five, g.week, data.now, !!data.geminiLimited),
    puesto('AGY-O', s.five, s.week, data.now),
  ]
  const orden = [...puestos].sort((a, b) => b.puntaje - a.puntaje).filter(p => p.puntaje > 0).map(p => p.nombre)
  const u = claude5?.used ?? 0
  const zonaClaude = u >= 90 ? 'critica' : u >= 75 ? 'reserva' : u >= 50 ? 'delegar' : 'normal'
  return { puestos, orden, zonaClaude }
}

const ZONA: Record<Turno['zonaClaude'], Key> = {
  normal: 'ctx.zone.normal',
  delegar: 'ctx.zone.delegar',
  reserva: 'ctx.zone.reserva',
  critica: 'ctx.zone.critica',
}

const NOTA: Record<Nota, Key> = { sinCupo: 'note.sinCupo', vence: 'note.vence', semana: 'note.semana' }

function fila(p: Puesto, lang: BandData['lang']): string {
  const label = p.nombre === 'AGY' ? t(lang, 'ctx.agy') : p.nombre === 'AGY-O' ? t(lang, 'ctx.agyO') : p.nombre
  const partes = [`${label}: 5 h ${p.usado === undefined ? t(lang, 'ctx.unknown') : t(lang, 'ctx.used', { n: Math.round(p.usado) })}`]
  if (p.renuevaMin !== undefined) {
    const time = p.renuevaMin >= 60
      ? t(lang, 'ctx.hoursMin', { h: Math.floor(p.renuevaMin / 60), m: p.renuevaMin % 60 })
      : t(lang, 'ctx.min', { m: p.renuevaMin })
    partes.push(t(lang, 'ctx.resetsIn', { time }))
  }
  if (p.semana !== undefined) partes.push(t(lang, 'ctx.week', { n: Math.round(p.semana) }))
  partes.push(t(lang, 'ctx.score', { n: p.puntaje }))
  return '- ' + partes.join(' · ') + (p.nota ? ` (${t(lang, NOTA[p.nota])})` : '')
}

/** Bloque que el modelo lee junto a cada mensaje del usuario (el usuario no lo ve). */
export function contextoTurno(data: BandData): string {
  const turn = turno(data)
  const socios = data.sociosLimits
  const sociosAlmostOut = Math.max(socios?.five?.used ?? 0, socios?.week?.used ?? 0) >= 90
  return [
    t(data.lang, 'ctx.header'),
    ...turn.puestos.map(p => fila(p, data.lang)),
    ...(sociosAlmostOut ? [t(data.lang, 'ctx.agyOLowQuota')] : []),
    t(data.lang, 'ctx.priority', { order: turn.orden.length ? turn.orden.join(' > ') : t(data.lang, 'ctx.nobody') }),
    t(data.lang, ZONA[turn.zonaClaude]),
  ].join('\n')
}
