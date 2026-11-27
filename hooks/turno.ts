import type { BandData, Reading } from '../types'
import { readings } from './limits'

/**
 * Reparto por cupo que vence: a quién conviene darle trabajo ahora.
 * - Claude dirige: se guarda una reserva (RESERVA %) para coordinar y revisar; si se agota, todo se detiene.
 * - El cupo libre que se renueva pronto se pierde si no se usa: suma prioridad.
 * - Una semana casi gastada o un corte (429) bajan o anulan la prioridad.
 */
export type Miembro = 'Claude' | 'Codex' | 'Gemini'
export type Puesto = {
  nombre: Miembro
  usado?: number          // % usado de la ventana de 5 h
  semana?: number         // % usado de la semana
  renuevaMin?: number     // minutos hasta que se renueva la ventana de 5 h
  libre: number           // % libre aprovechable (Claude: descontada la reserva)
  puntaje: number
  nota?: string
}
export type Turno = { puestos: Puesto[]; orden: Miembro[]; zonaClaude: 'normal' | 'delegar' | 'reserva' | 'critica' }

export const RESERVA = 25
const MIN = 60_000

function puesto(nombre: Miembro, cinco: Reading | undefined, semana: Reading | undefined, now: number, cortado = false): Puesto {
  const usado = cinco?.used
  const sem = semana?.used
  const renuevaMin = cinco?.resetsAt !== undefined && cinco.resetsAt > now ? Math.ceil((cinco.resetsAt - now) / MIN) : undefined
  if (cortado || (usado ?? 0) >= 97 || (sem ?? 0) >= 97) {
    return { nombre, usado, semana: sem, renuevaMin, libre: 0, puntaje: 0, nota: 'sin cupo' }
  }
  // Sin lectura: se asume medio cupo, sin bono de vencimiento.
  const bruto = usado === undefined ? 50 : 100 - usado
  const libre = Math.max(0, bruto - (nombre === 'Claude' ? RESERVA : 0))
  // Bono por vencer: hasta ×2 si se renueva en ≤ 60 min (lo libre se pierde al renovarse).
  const vence = renuevaMin !== undefined && renuevaMin <= 60 ? 1 + (60 - renuevaMin) / 60 : 1
  const freno = sem !== undefined && sem >= 85 ? 0.3 : 1
  const nota = renuevaMin !== undefined && renuevaMin <= 30 && libre >= 10 ? 'cupo por vencer: úsalo primero'
    : freno < 1 ? 'semana casi gastada' : undefined
  return { nombre, usado, semana: sem, renuevaMin, libre, puntaje: Math.round(libre * vence * freno), nota }
}

export function turno(data: BandData): Turno {
  const { claude5, claude7, codex5, codex7 } = readings(data)
  const g = data.geminiLimits ?? {}
  const puestos = [
    puesto('Claude', claude5, claude7, data.now),
    puesto('Codex', codex5, codex7, data.now),
    puesto('Gemini', g.five, g.week, data.now, !!data.geminiLimited),
  ]
  const orden = [...puestos].sort((a, b) => b.puntaje - a.puntaje).filter(p => p.puntaje > 0).map(p => p.nombre)
  const u = claude5?.used ?? 0
  const zonaClaude = u >= 90 ? 'critica' : u >= 75 ? 'reserva' : u >= 50 ? 'delegar' : 'normal'
  return { puestos, orden, zonaClaude }
}

const ZONA: Record<Turno['zonaClaude'], string> = {
  normal: 'Claude < 50 %: reparto normal (Claude planea y revisa; Codex y Gemini programan en paralelo).',
  delegar: 'Claude 50–75 %: delega TODA implementación y exploración, incluso cambios chicos; Claude solo planea, decide y revisa diffs.',
  reserva: 'Claude 75–90 %: zona de reserva. Solo coordinar. Encarga trabajos largos y autónomos a Codex/Gemini (siguen aunque Claude pare) y respuestas cortas.',
  critica: 'Claude ≥ 90 %: crítico. Lanza en segundo plano lo pendiente con encargos completos, avisa al usuario de la hora de renovación y no hagas trabajo propio.',
}

function fila(p: Puesto): string {
  const partes = [`${p.nombre}: 5 h ${p.usado === undefined ? '¿?' : Math.round(p.usado) + ' % usado'}`]
  if (p.renuevaMin !== undefined) partes.push(`se renueva en ${p.renuevaMin >= 60 ? Math.floor(p.renuevaMin / 60) + ' h ' + (p.renuevaMin % 60) + ' min' : p.renuevaMin + ' min'}`)
  if (p.semana !== undefined) partes.push(`semana ${Math.round(p.semana)} %`)
  partes.push(`puntaje ${p.puntaje}`)
  return '- ' + partes.join(' · ') + (p.nota ? ` (${p.nota})` : '')
}

/** Bloque que el modelo lee junto a cada mensaje del usuario (el usuario no lo ve). */
export function contextoTurno(data: BandData): string {
  const t = turno(data)
  return [
    'Estado del equipo (mod estado-equipo; dato automático, no es un mensaje del usuario):',
    ...t.puestos.map(fila),
    `Prioridad para dar trabajo ahora: ${t.orden.length ? t.orden.join(' > ') : 'nadie tiene cupo: avisa al usuario'}.`,
    ZONA[t.zonaClaude],
  ].join('\n')
}
