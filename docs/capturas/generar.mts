import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { BandData } from '../../types/index.d.ts'
import type { Segment } from '../../hooks/band.ts'
import type { Lang } from '../../hooks/i18n.ts'

// The plugin uses extensionless TypeScript imports.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context)
    }
    return next(specifier, context)
  },
})
const { bandRows } = await import('../../hooks/band.ts')
const { contextoTurno } = await import('../../hooks/turno.ts')
const { t } = await import('../../hooks/i18n.ts')

const scenarios = [
  { kind: 'cover', files: ['cover', 'es/portada'], widths: [1280, 1280], height: 640, titles: ['', ''] },
  { kind: 'normal', files: ['normal', 'es/normal'], widths: [1268, 1268], height: 279,
    titles: ['Three subagents in the background', 'Tres subagentes en segundo plano'] },
  { kind: 'reserve', files: ['reserve', 'es/reserva'], widths: [1268, 1268], height: 235,
    titles: ['Claude in reserve · AGY resets in 12 min', 'Claude en zona de reserva · AGY se renueva en 12 min'] },
  { kind: 'limit', files: ['limit', 'es/corte-gemini'], widths: [1268, 1268], height: 213,
    titles: ['AGY-O almost out of quota · Codex almost full', 'AGY-O casi sin cupo · Codex casi lleno'] },
  { kind: 'narrow', files: ['narrow', 'es/angosta'], widths: [440, 473], height: 235,
    titles: ['Narrow window: less detail, rows intact', 'Ventana angosta: menos detalle, sin romper filas'] },
] as const
type Scenario = typeof scenarios[number]['kind']

function sample(kind: Scenario, lang: Lang): BandData {
  const now = Date.UTC(2026, 0, 1)
  const minute = 60_000
  const reading = (used: number, minutes: number) => ({ used, resetsAt: now + minutes * minute, at: now })
  const week = (used: number, days: number) => reading(used, days * 1440)
  const reserve = kind === 'reserve' || kind === 'cover'
  const limit = kind === 'limit'
  const claude = [reading(reserve ? 82 : limit ? 41 : 6, reserve ? 100 : limit ? 180 : 266),
    week(reserve ? 64 : limit ? 30 : 17, reserve ? 3 : limit ? 4 : 6)]

  const sonnet = { model: 'claude-sonnet-5-5', working: true,
    task: lang === 'es' ? 'Revisión de diseño del tablero' : 'Dashboard design review' }
  const agy = { model: 'claude-haiku-5-5', type: 'gemini', working: true,
    task: lang === 'es' ? 'Revisar el audio de la entrevista' : 'Review the interview audio' }
  const codex = { model: 'claude-sonnet-5-5', type: 'codex', working: true,
    task: lang === 'es' ? 'Corregir la subida de videos' : 'Fix video uploads' }

  return {
    now, lang, model: 'claude-opus-5-5', working: true,
    limits: claude.map((r, index) => ({
      kind: index === 0 ? 'five_hour' : 'seven_day',
      percentUsed: r.used, resetsAt: new Date(r.resetsAt).toISOString(),
    })),
    lastRequestAt: now - 2 * minute,
    agents: kind === 'normal' ? [sonnet, agy, codex] : kind === 'reserve' ? [codex] : [],
    codexModel: 'GPT-5.5', codexModifiedAt: now, codexToday: 1_200_000,
    codex: { five: reading(limit ? 91 : 18, limit ? 25 : 209), week: week(limit ? 88 : 9, limit ? 2 : 5) },
    geminiModel: 'Gemini 4 Neon (High)', geminiModelAt: now,
    geminiModifiedAt: now, geminiToday: 3, geminiLastAt: now - 6 * minute,
    geminiLimits: { five: reading(reserve ? 35 : 6, reserve ? 12 : 75), week: week(reserve ? 20 : 1, 6) },
    sociosModel: 'GPT-5.5 High', sociosModelAt: now - 5_000,
    sociosLimits: { five: reading(limit ? 97 : 28, limit ? 125 : 152), week: week(limit ? 92 : 12, 5) },
    sys: { memUsed: 0.61 * 16 * 1024 ** 3, memTotal: 16 * 1024 ** 3,
      claude: { count: 1, bytes: 1.1 * 1024 ** 3 }, codex: { count: 1, bytes: 420 * 1024 ** 2 },
      gemini: { count: 1, bytes: 180 * 1024 ** 2 } },
  }
}

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
// Turn, activity and memory still use the internal group name in bandRows.
const groupLabel = (text: string) => text   // la banda ya usa AGY; no se reescribe nada

function renderRows(rows: Segment[][]): string {
  return rows.map(row => '<div class="row">' + row.map(({ text, color, dim, bold }) => {
    const style = color ? ` style="color:${color}"` : ''
    const classes = [dim && 'dim', bold && 'bold', text.startsWith('░') && 'shade'].filter(Boolean).join(' ')
    return `<span class="${classes}"${style}>${escape(groupLabel(text))}</span>`
  }).join('') + '</div>').join('\n')
}

const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; }
  body { background: #0e1319; color: #e6edf3; font-family: system-ui, sans-serif; }
  .window, .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; }
  .window { height: 100%; overflow: hidden; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 8px; height: 34px; flex: none;
    padding: 0 14px; background: #21262d; color: #8b949e; font-size: 12px; }
  header i, .pill i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; }
  header span { margin-left: 10px; white-space: nowrap; }
  .red { background: #ff6058; } .yellow { background: #ffbd2e; } .green { background: #28c840; }
  .band, footer { font: 15px/20px Consolas, "Courier New", monospace; }
  .band { padding: 16px 18px 4px; }
  .row { white-space: pre; }
  .shade { display: inline-block; overflow: hidden; height: 1.15em; line-height: 1.15em; vertical-align: -.18em; }
  .narrow .band { font-size: 14px; line-height: 22px; }
  .dim { color: #8b949e; } .bold { font-weight: 700; }
  footer { margin-top: auto; height: 39px; flex: none; border-top: 1px solid #30363d;
    padding: 5px 18px; color: #d97757; font-weight: 700; }
  .limit .band { padding-top: 10px; padding-bottom: 4px; line-height: 19px; }
  .limit footer { height: 29px; }
  .warning { white-space: pre; color: #f85149; font-weight: 700; }
  .poster { height: 100%; padding: 108px 80px 0; background-image:
    linear-gradient(#ffffff08 1px, transparent 1px), linear-gradient(90deg, #ffffff08 1px, transparent 1px);
    background-size: 40px 40px; }
  .pills { display: flex; gap: 10px; }
  .pill { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px;
    background: #161b22; border: 1px solid #30363d; border-radius: 99px; font-size: 14px; font-weight: 600; }
  .pill i { width: 10px; height: 10px; }
  .claude { background: #d97757; } .codex { background: #10a37f; } .agy { background: #4285f4; }
  h1 { margin: 23px 0 12px; font: bold 88px/1.1 Consolas, "Courier New", monospace; letter-spacing: -2px; }
  p { margin: 0; max-width: 980px; color: #c9d1d9; font-size: 26px; line-height: 36px; }
  p strong { color: #fff; }
  .card { margin-top: 43px; padding: 17px 22px; font-size: 17px; line-height: 25px; }
`

function html(kind: Scenario, lang: Lang, title: string, columns: number): string {
  const data = sample(kind, lang)
  const rows = bandRows(data, columns)
  const turnLabel = t(lang, 'band.turn')
  const coverRows = rows.filter((row, index) => index < 4 || row[0].text.trim() === turnLabel)
  const notice = t(lang, 'ctx.agyOLowQuota')
  const warning = contextoTurno(data).split('\n').find(line => line === notice)
  const subtitle = lang === 'es'
    ? 'Los límites de <strong>Claude, Codex y Antigravity (Gemini + Claude/GPT)</strong> en una sola banda, y a quién darle el siguiente trabajo <strong>antes de que Claude llegue al 100 %</strong>.'
    : '<strong>Claude, Codex and Antigravity (Gemini + Claude/GPT)</strong> limits in one band, and who should get the next job <strong>before Claude hits 100 %</strong>.'
  const content = kind === 'cover'
    ? `<main class="poster"><div class="pills">
        <span class="pill"><i class="claude"></i>Claude</span><span class="pill"><i class="codex"></i>Codex</span>
        <span class="pill"><i class="agy"></i>AGY</span><span class="pill"><i class="agy"></i>AGY-O</span>
        <span class="pill dim">${lang === 'es' ? 'mod para Claude Code' : 'mod for Claude Code'}</span>
      </div><h1>trio-ia-band<span class="dim">_</span></h1><p>${subtitle}</p>
      <section class="band card">${renderRows(coverRows)}</section></main>`
    : `<main class="window ${kind}"><header><i class="red"></i><i class="yellow"></i><i class="green"></i>
        <span>Claude Code — ${escape(title)}</span></header>
      <section class="band">${renderRows(rows)}
        ${warning ? `<div class="warning">${escape(groupLabel(warning))}</div>` : ''}
      </section><footer>&gt;</footer></main>`
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>${escape(title || 'trio-ia-band')}</title>
  <style>${css}</style><body>${content}</body></html>`
}

const installs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
const browser = [process.env.BROWSER_EXE, ...installs.flatMap(root => [
  join(root!, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(root!, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
])].find(path => path && existsSync(path))
if (!browser) throw new Error('Set BROWSER_EXE to the Chrome or Edge executable.')

const scratch = mkdtempSync(join(tmpdir(), 'trio-capturas-'))
try {
  const outputs: { file: string; png: Buffer }[] = []
  for (const [index, lang] of (['en', 'es'] as const).entries()) {
    for (const scenario of scenarios) {
      const { kind, height } = scenario
      const width = scenario.widths[index]
      const name = scenario.files[index]
      const columns = kind === 'cover' ? 94 : kind === 'narrow' ? 50 : 149
      const source = join(scratch, `${lang}-${kind}.html`)
      const image = join(scratch, `${lang}-${kind}.png`)
      writeFileSync(source, html(kind, lang, scenario.titles[index], columns))
      const result = spawnSync(browser, [
        '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-gpu',
        ...(process.env.CAPTURAS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
        '--no-first-run', '--disable-background-networking', `--user-data-dir=${join(scratch, 'profile')}`,
        `--window-size=${width},${height}`, `--screenshot=${image}`, pathToFileURL(source).href,
      ], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
      if (result.error) throw result.error
      if (result.status !== 0 || !existsSync(image)) throw new Error(`Screenshot failed for ${name}: ${result.stderr}`)
      const png = readFileSync(image)
      if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
        throw new Error(`Unexpected PNG dimensions for ${name}`)
      }
      outputs.push({ file: name + '.png', png })
    }
  }
  for (const { file, png } of outputs) {
    writeFileSync(new URL(`../${file}`, import.meta.url), png)
    console.log(`docs/${file}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
}
