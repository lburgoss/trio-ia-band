import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import { codexDays } from '../hooks/codex'

const NOW = new Date(2030, 0, 7, 12).getTime()
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const RUN = { command: 'estado', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 180 } }
const view = (surface: 'terminal' | 'desktop') => ({
  plugin: 'estado-equipo', component: 'AbovePrompt' as const, surface,
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, bodyColumns: 180, maxRows: 10, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

function world(on: On, codexHome?: string, claudeUsed = 5, agents: AgentInfo[] = []) {
  const cleared: (string | undefined)[] = []
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    cleared.push(e.text)
    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW, context: { tokens: 0, window: 100, percent: 0 },
      rateLimits: [{ kind: 'five_hour', percentUsed: claudeUsed }, { kind: 'seven_day', percentUsed: 7 }],
    },
  }))
  on('env.get', ($, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'CODEX_HOME' ? codexHome : undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('agent.list', () => ({ value: agents }))
  return { cleared, store }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`renderiza la banda y conserva el contenido inferior en ${surface}`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { cleared, store } = world(on)
    let renders = 0
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      renders++
      return $.ui.resolve(e).Text({ children: 'Contenido inferior' })
    })
    await $.session.start({ ...START, surface })
    const band = await $.ui.mount(view(surface))
    const text = async () => (await band.findAll({ type: 'Text' })).map(node => node.text)
    expect((await text()).join('')).toContain('CLAUDE')
    expect((await text()).at(-1)).toBe('Contenido inferior')
    const initialRenders = renders
    await clock.advance(6000)
    expect((await text()).join('')).toContain('CLAUDE')
    expect(renders).toBe(initialRenders)
    await $.command.run(RUN)
    expect(await text()).toEqual(['Contenido inferior'])
    expect(store.get('enabled')).toBe(false)
    await $.command.run(RUN)
    expect((await text()).join('')).toContain('CODEX')
    expect(store.get('enabled')).toBe(true)
    // /team-band (English) toggles the same band as its Spanish alias /estado.
    await $.command.run({ ...RUN, command: 'team-band' })
    expect(await text()).toEqual(['Contenido inferior'])
    expect(store.get('enabled')).toBe(false)
    await $.command.run({ ...RUN, command: 'team-band' })
    expect((await text()).join('')).toContain('CODEX')
    expect(store.get('enabled')).toBe(true)
    expect(cleared).toEqual([undefined])
    await band.unmount()
  })
}

test('la sesión activa mantiene a Claude en verde y solo el turno principal renueva su caché', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { store } = world(on)
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 40, cache_creation_input_tokens: 50 },
    }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start(START)
  const band = await $.ui.mount(view('terminal'))
  const text = async () => (await band.findAll({ type: 'Text' })).map(node => node.text).join('')
  const dot = async (row: number) => (await band.findAll({ type: 'Text' })).filter(node => node.text === '●' || node.text === '○' || node.text === '⏸').map(node => node.props.color)[row]
  const step = async (turnId: string, agentId?: string) => {
    for await (const chunk of $.turn.step({ turnId, agentId, index: 0, model: agentId ? 'claude-haiku-5-5' : 'claude-opus-5-5', messageCount: 1 })) void chunk
  }
  const complete = (turnId: string, agentId?: string) =>
    $.turn.complete({ turnId, agentId, reason: 'answer', answer: '', durationMs: 200, isAborted: false })
  await step('agent', 'a')
  expect(await dot(0)).toBe('#3FB950')
  // The label depends on the detected language (English by default, «Caché» in Spanish).
  expect(await text()).toMatch(/Cach[eé]\s+—/)
  await step('main')
  expect(await dot(0)).toBe('#3FB950')
  expect(await text()).toMatch(/Cach[eé]\s+60 min/)
  await complete('agent', 'a')
  expect(await dot(0)).toBe('#3FB950')
  await complete('main')
  expect(await dot(0)).toBe('#3FB950')
  expect(store.get('tokens:test-session')).toBe(280)
  await band.unmount()
})

test('pinta en verde un subagente de Codex en marcha y apaga a Claude sin cupo', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, undefined, 100, [
    { id: 'cx', type: 'codex:codex-rescue', status: 'running', description: 'Fix bug' } as AgentInfo,
  ])
  await $.session.start(START)
  const band = await $.ui.mount(view('terminal'))
  const status = async (row: number) => (await band.findAll({ type: 'Text' }))
    .filter(node => node.text === '●' || node.text === '○' || node.text === '⏸')[row]
  expect((await status(0))?.text).toBe('⏸')
  expect((await status(0))?.props.color).toBe('#484F58')
  expect((await status(1))?.text).toBe('●')
  expect((await status(1))?.props.color).toBe('#3FB950')
  expect((await status(2))?.text).toBe('○')
  expect((await status(2))?.props.color).toBe('#8B949E')
  await band.unmount()
})

test('Codex consulta el stat cada 5 s y redescubre archivos cada 60 s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, '/codex')
  const [day] = codexDays(NOW)
  const dir = `/codex/sessions/${day}`
  const path = `${dir}/rollout-test.jsonl`
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^[a-z]:/i, '')
  const length = 256 * 1024
  const reads: number[] = []
  let scans = 0
  let stats = 0
  let stamp = NOW
  const file = () => ({ kind: 'file' as const, size: length + 24, mtimeMs: stamp, isLink: false })
  on('fs.list', ($, e) => {
    if (normalize(e.path) !== dir) return { value: [] }
    scans++
    return { value: [{ name: 'rollout-test.jsonl', ...file() }] }
  })
  on('fs.stat', ($, e) => {
    expect(normalize(e.path)).toBe(path)
    stats++
    return { value: file() }
  })
  on('fs.read', ($, e) => {
    expect(normalize(e.path)).toBe(path)
    expect(e.offset).toBe(24)
    expect(e.length).toBe(length)
    const total = stamp === NOW ? 12 : 25
    reads.push(total)
    const line = JSON.stringify({
      timestamp: new Date(stamp).toISOString(), type: 'event_msg', payload: {
        type: 'token_count', info: { total_token_usage: { total_tokens: total } },
        rate_limits: { primary: { window_minutes: 300, used_percent: 5 }, secondary: { window_minutes: 10080, used_percent: 0 } },
      },
    })
    return { value: `fragment\n${line}\n` }
  })
  await $.session.start(START)
  const band = await $.ui.mount(view('terminal'))
  const text = async () => (await band.findAll({ type: 'Text' })).map(node => node.text).join('')
  const dot = async (row: number) => (await band.findAll({ type: 'Text' })).filter(node => node.text === '●' || node.text === '○' || node.text === '⏸').map(node => node.props.color)[row]
  expect(await dot(1)).toBe('#8B949E')
  expect(await text()).toContain('5 %')
  await clock.advance(5000)
  expect(stats).toBe(1)
  expect(reads).toEqual([12])
  stamp += 6000
  await clock.advance(5000)
  expect(reads).toEqual([12, 25])
  expect(scans).toBe(1)
  expect(await text()).toContain('25 tokens')
  await clock.advance(26_000)
  expect(await dot(1)).toBe('#8B949E')
  await clock.advance(24_000)
  expect(scans).toBe(2)
  expect(reads).toEqual([12, 25])
  await band.unmount()
})
