import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Run, Words } from '../types'
import { heat, localInsults } from './anger'
import { PATTERNS, cyclesFor, encode, moment, paint, runSeconds } from './sky'

// Summed heat that opens the window, by the `sensitivity` setting.
const TRIGGERS: Record<string, number> = { low: 8, normal: 5, high: 3 }
const HALF_LIFE = 10 * 60_000 // heat halves every 10 minutes
const HINT_MS = 5 * 60_000
const PANE = 'breathe'
const FRAME_MS = 33
// Prompts the machinery sends, not the person: never scored.
const MACHINE = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'coordinator',
  'observer', 'observer-activity', 'auto-continuation'])

// "30 s" / "30 min" / "1 h" → milliseconds; "off" → 0.
const UNIT: Record<string, number> = { s: 1000, min: 60_000, h: 3_600_000 }
const duration = (text: unknown) => {
  const m = /(\d+)\s*(h|min|s)\b/.exec(String(text))
  return m ? Number(m[1]) * (UNIT[m[2] ?? ''] ?? 0) : 0
}

type Breath = { pattern: string; seconds: number; volume: number; where: string }

const runRef = atom({ plugin: 'breathe', key: 'run' } as const, null as Run | null)
const wordsRef = atom({ plugin: 'breathe', key: 'words' } as const, { label: '', count: '', done: 0 } as Words)
const wordsOf = (m: Words): Words => ({ label: m.label, count: m.count, done: m.done })
const windows = ($: EngineInterface) => /^[A-Za-z]:[\\/]/.test($.plugin.root)

// The pane's run, kept here for the frame clock; $.state holds it for drawing and across a reload.
let current: Run | undefined
let timer: Timer | undefined
let drawn: { columns: number; rows: number } | undefined
let painting = false
let refused = false

// One frame: the words when they change (a redraw), else the picture alone (a blit).
async function tick($: EngineInterface) {
  const run = current
  if (run === undefined || painting) return
  painting = true
  try {
    const time = ((await $.clock.now()) - run.startedAt) / 1000
    if (time >= runSeconds(run)) return void await end($, false)
    const m = moment(run, time), words = wordsOf(m), shown = await read($, wordsRef)
    if (words.label !== shown.label || words.count !== shown.count || words.done !== shown.done) {
      await update($, wordsRef, () => words)
    } else if (drawn !== undefined) {
      const { columns, rows } = drawn
      const r = await $.ui.blit({ requestId: PANE, key: 'sky', columns, rows, cells: encode(paint(m, time, columns, rows)) })
      // Refused (resized, or another tab shown): draw again once, not on every frame it stays refused.
      if ('deny' in r && r.deny !== undefined) { if (!refused) $.ui.invalidate('ui.render'); refused = true }
      else refused = false
    }
  } finally {
    painting = false
  }
}

function follow($: EngineInterface, run: Run) {
  current = run
  timer?.cancel()
  timer = $.clock.every(FRAME_MS, () => void tick($))
}

// Stops the run; `early` (closed by the person) also silences the drone, which otherwise ends with it.
async function end($: EngineInterface, early: boolean) {
  const run = current
  if (run === undefined) return
  current = undefined
  timer?.cancel()
  timer = undefined
  drawn = undefined
  await $.state.set({ plugin: 'breathe', key: 'run' }, null)
  if (early && windows($)) {
    void $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
      // Not this process, whose own command line matches the filter too.
      `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%drone.ps1%${run.startedAt}%' AND ProcessId != $PID" | Invoke-CimMethod -MethodName Terminate | Out-Null`])
      .catch((err: unknown) => $.ui.log(`breathe: ${String(err)}`))
  }
  await $.ui.close({ id: PANE })
}

// /breathe stop: the pane, else Edge's window, found by its own profile on the command line.
// Clears lastOpen, so /breathe right after is not "already open".
async function stop($: EngineInterface): Promise<string> {
  if (current !== undefined) await end($, true)
  else if (!windows($)) return 'nothing to stop'
  else {
    const r = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
      `$p = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' AND CommandLine LIKE '%claude-breathe%'"); `
      + '$p | Invoke-CimMethod -MethodName Terminate | Out-Null; $p.Count'])
    if (!(Number(r.stdout.trim()) > 0)) return 'nothing to stop'
  }
  await $.store.set('lastOpen', 0)
  return 'stopped'
}

const launch = ($: EngineInterface, argv: string[], timeoutMs: number) =>
  void $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ...argv],
    { timeoutMs })
    .then(r => { if (r.exitCode !== 0) $.ui.log(`breathe: ${r.stderr.trim() || `${argv[0]} exited ${r.exitCode}`}`) })
    .catch((err: unknown) => $.ui.log(`breathe: ${String(err)}`))

// The pane beside the chat; false when the surface would not place it (unasked on a narrow terminal).
async function openPane($: EngineInterface, breath: Breath, now: number): Promise<boolean> {
  if (!(await $.session.surfaces()).includes('terminal')) return false // the picture is terminal cells
  const run: Run = { pattern: breath.pattern, cycles: cyclesFor(breath.pattern, breath.seconds), startedAt: now }
  await $.state.set({ plugin: 'breathe', key: 'run' }, run)
  await update($, wordsRef, () => wordsOf(moment(run, 0)))
  follow($, run)
  const opened = await $.ui.open({ id: PANE, title: 'Breathe', rows: 18, closeOnEscape: true })
  if (!opened.isPlaced) {
    await end($, false)
    return false
  }
  if (breath.volume > 0 && windows($)) {
    const root = $.plugin.root.replace(/\\/g, '/')
    launch($, [`${root}/scripts/drone.ps1`, '-Pattern', run.pattern, '-Cycles', String(run.cycles), '-Volume',
      String(breath.volume), '-StartedAt', String(now)], runSeconds(run) * 1000 + 60_000)
  }
  return true
}

// Opens the breath unless any session opened one within `gap`: the pane, or Edge's window when that is
// the setting or the pane could not be placed. Says what happened, for /breathe.
async function open($: EngineInterface, breath: Breath, gap: number): Promise<string> {
  const now = await $.clock.now()
  if (current !== undefined || now - Number((await $.store.get('lastOpen')) ?? 0) < gap) {
    return 'a breathing window is already open; /breathe stop closes it'
  }
  if (breath.where === 'pane' && await openPane($, breath, now)) {
    await $.store.set('lastOpen', now)
    return 'Breathe. /breathe stop closes it, or Esc at an empty prompt.'
  }
  if (!windows($)) {
    return breath.where === 'pane' ? 'no room for the breathing pane here; widen the terminal or run /breathe'
      : 'the breathing window needs Windows and Edge'
  }
  await $.store.set('lastOpen', now)
  const root = $.plugin.root.replace(/\\/g, '/')
  const url = `file:///${encodeURI(`${root}/ui/breathe.html`)}?p=${breath.pattern}&s=${breath.seconds}&v=${breath.volume}`
  // Not awaited: the launcher keeps the window pinned on top until it closes.
  launch($, [`${root}/scripts/launch.ps1`, '-Url', url], breath.seconds * 1000 + 60_000)
  return 'Breathe. The window is in the bottom-right corner; Esc or /breathe stop closes it.'
}

export const register: Register = (on, options) => {
  const seconds = duration(options.length) / 1000 || 30
  const volume = options.sound === true ? Math.min(100, parseInt(String(options.volume), 10) || 35) / 100 : 0
  const breath: Breath = { pattern: String(options.pattern), seconds, volume, where: String(options.where ?? 'pane') }
  const windowMs = seconds * 1000 + 15_000 // its breathing plus Edge's start-up
  const every = duration(options.schedule)
  const cooldown = duration(options.cooldown) || 3_600_000
  const trigger = TRIGGERS[String(options.sensitivity)] ?? TRIGGERS.normal!
  let level = 0
  let scoredAt = 0
  let last = 0 // the last prompt's own heat, for /breathe heat
  const heatNow = (now: number) => level * 0.5 ** ((now - scoredAt) / HALF_LIFE)
  let extra: RegExp | undefined // your own insults, from insults.local.txt

  on('session.start', async ($, e, next) => {
    const local = await $.fs.read(`${$.plugin.root}/insults.local.txt`).catch(() => undefined)
    extra = typeof local === 'string' ? localInsults(local) : undefined
    await $.command.register({
      name: 'breathe',
      description: 'A short breathing exercise beside the chat',
      argumentHint: '[4-6|box|4-7-8|heat|stop]',
      immediate: true,
    })
    if (every > 0) $.clock.every(every, () => void open($, breath, every - 60_000))
    // A reload mid-breath: pick the run up again, or close what it left.
    const { value: run } = await $.state.get({ plugin: 'breathe', key: 'run' })
    if (run) {
      if (((await $.clock.now()) - run.startedAt) / 1000 < runSeconds(run)) follow($, run)
      else { current = run; await end($, false) }
    }
    return next(e)
  })

  on('command.run', { command: 'breathe' }, async ($, e) => {
    const asked = e.args.trim()
    const names = Object.keys(PATTERNS)
    if (asked === 'heat') {
      const now = await $.clock.now()
      const wait = cooldown - (now - Number((await $.store.get('lastHot')) ?? 0))
      const off = options.anger === 'off' ? ' Hot prompts are off.' : ''
      return { text: `heat ${heatNow(now).toFixed(1)} of ${trigger} (sensitivity ${options.sensitivity}), `
        + `the last prompt ${last.toFixed(1)}; it halves every 10 min. Next hot break `
        + `${wait > 0 ? `in ${Math.ceil(wait / 60_000)} min at the earliest` : 'possible now'}.${off}` }
    }
    if (asked === 'stop') return { text: await stop($) }
    if (asked !== '' && !names.includes(asked)) return { text: `pick ${names.join(', ')}, heat, stop, or nothing` }
    return { text: await open($, asked === '' ? breath : { ...breath, pattern: asked }, windowMs) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text, Raster } = $.ui.resolve(e)
    const run = await read($, runRef), words = await read($, wordsRef)
    if (run === null) return <Text dimColor> </Text>
    const columns = Math.max(12, e.props.bodyColumns)
    const rows = Math.max(6, Math.min(e.props.scroll.bodyRows - 3, Math.round(columns * 0.6)))
    drawn = { columns, rows }
    refused = false
    const time = ((await $.clock.now()) - run.startedAt) / 1000
    const dots = Array.from({ length: run.cycles }, (_, i) => (i < words.done ? '●' : '·')).join(' ')
    return (
      <Box flexDirection="column">
        <Raster key="sky" columns={columns} rows={rows} cells={encode(paint(moment(run, time), time, columns, rows))} />
        <Box justifyContent="center">
          <Text italic>{words.label}</Text>
          <Text dimColor>{words.count === '' ? '' : `  ${words.count}`}</Text>
        </Box>
        <Box justifyContent="center"><Text dimColor>{dots}</Text></Box>
        {/* Only the fullscreen terminal reports clicks; on the main screen a button (or the frame's X) is dead. */}
        <Box justifyContent="center">
          {e.viewport?.isFullscreen === true
            ? <Box><Button key="stop" label="stop" hotkey="s" onPress={() => end($, true)} /><Text dimColor>  or /breathe stop</Text></Box>
            : <Text dimColor>/breathe stop to cancel</Text>}
        </Box>
      </Box>
    )
  })

  // The person's close mark or Esc: stop drawing, and the drone with it.
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE && e.origin.kind !== 'plugin') await end($, true)
    return r
  }).catch(($, e, next) => next(e)) // a failure here never keeps a pane open

  // Scores what the person typed; the prompt itself goes on untouched.
  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin as typeof e.origin | undefined
    const machine = MACHINE.has(origin?.kind ?? '') || (origin?.kind === 'plugin' && origin.asUser !== true)
    if (options.anger === 'off' || e.command !== undefined || e.isMeta === true || machine) return next(e)
    const now = await $.clock.now()
    last = heat(e.text, extra)
    level = heatNow(now) + last
    scoredAt = now
    if (level >= trigger &&now - Number((await $.store.get('lastHot')) ?? 0) >= cooldown) {
      level = 0
      await $.store.set('lastHot', now)
      if (options.anger === 'hint') {
        $.ui.status('rough one? /breathe')
        $.clock.after(HINT_MS, () => $.ui.status(undefined))
      } else {
        await open($, breath, windowMs)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // only watches: a failure here never blocks a prompt
}
