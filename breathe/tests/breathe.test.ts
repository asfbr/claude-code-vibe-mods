import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { heat, localInsults } from '../hooks/anger'

// The world beneath the mod: window launches, panes, drones, status lines and logs are recorded; clock and
// store in memory. `placed: false` is a terminal too narrow for a pane opened unasked; `insults`, the
// text of insults.local.txt (none: the file is missing).
const world = (on: On, { surfaces = ['terminal'], placed = true, insults = undefined as string | undefined } = {}) => {
  const seen = { launches: [] as string[], panes: [] as string[], closes: 0, drones: [] as string[][], kills: 0,
    status: [] as (string | undefined)[], logs: [] as string[] }
  const clock = mock.clock(on, { now: 1_000_000_000 })
  mock.store(on)
  on('fs.read', () => {
    if (insults === undefined) throw new Error('ENOENT')
    return { value: insults }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: surfaces as never }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.status', ($, e) => { seen.status.push(e.text); return { value: undefined } })
  on('ui.log', ($, e) => { seen.logs.push(e.text); return { value: undefined } })
  on('ui.open', ($, e) => {
    seen.panes.push(e.id)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } as never }
  })
  on('ui.close', () => { seen.closes++; return { value: undefined } })
  on('ui.blit', () => ({ value: {} }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    const script = e.argv.find(a => a.endsWith('.ps1')) ?? ''
    if (script.endsWith('launch.ps1')) seen.launches.push(e.argv.at(-1) ?? '')
    else if (script.endsWith('drone.ps1')) seen.drones.push(e.argv.slice(e.argv.indexOf(script) + 1))
    else if (e.argv.some(a => a.includes('Terminate'))) seen.kills++
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { seen, clock, opened: () => seen.panes.length + seen.launches.length }
}

const start = ($: Engine) => $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
const say = ($: Engine, text: string, kind: 'composer' | 'task-notification' = 'composer') =>
  $.prompt.submit({ text, wait: false, origin: { kind } })
const breathe = ($: Engine, args = '') =>
  $.command.run({ command: 'breathe', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
const MIN = 60_000
const PANE = {
  plugin: 'breathe', component: 'Pane', requestId: 'breathe', surface: 'terminal',
  props: { title: 'Breathe', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 18 }, view: {} },
} as const

// Casual swearing while explaining, not a meltdown.
const CASUAL = [
  "2. i didnt really get the difference between the two panels. once the build is running i dont want to do fucking anything else. what is the option there? explain it fucking better",
  'really? so that splash screen was a piece of shit, nobody waits for it. i will take your rec here.',
]
const HOT = [
  'WTF this is STILL broken!!!',
  'fuck. again?? how many times do I have to tell you',
  'porra, de novo não funciona',
]

describe('heat', () => {
  test('swearing and !!! alone are not anger, however much of it', async () => {
    expect(heat('explain fucking better')).toBe(0)
    expect(heat('fuck fuck fuck, this shit is a motherfucker')).toBe(0)
    expect(heat('nice!!! that fucking worked??')).toBe(0)
    expect(heat('can you rename the hook')).toBe(0)
  })

  test('frustration, insults and shouting score; swears and !!! amplify them', async () => {
    expect(heat('you imbecile')).toBe(1)
    expect(heat('seu idiota')).toBe(1)
    expect(heat('WHY DOES THIS KEEP FAILING!!!')).toBe(4) // all caps 3 + !!! 1
    expect(Math.abs(heat('porra, de novo não funciona') - (1 + 2 ** 1.5))).toBeLessThan(1e-9) // repeats compound
    expect(heat('fuck. again?? how many times do I have to tell you')).toBeLessThan(5)
    expect(heat('fuck fuck fuck, again?')).toBeGreaterThanOrEqual(5) // one very heated prompt opens it alone
  })

  test('a local insult list scores like the built-in one; comments and bad lines are skipped', async () => {
    const extra = localInsults('# mine\nzorp\\w*\n\n(unclosed\r\nblarg')
    expect(heat('you zorpface', extra)).toBe(1)
    expect(Math.abs(heat('blarg, zorpy', extra) - 2 ** 1.5)).toBeLessThan(1e-9)
    expect(heat('you zorpface')).toBe(0)
    expect(localInsults('# only a comment\n')).toBeUndefined()
  })

  test('pasted code and acronyms in normal prose do not count', async () => {
    expect(heat('the log says ```FATAL ERROR!!! shit happened```, can you check the JSON parser?')).toBe(0)
    expect(heat('update the README and the API docs')).toBe(0)
  })
})

describe('hot prompts', () => {
  test('casual swearing never opens the window', async ($, on) => {
    const { clock, opened } = world(on)
    await start($)
    for (const text of CASUAL) { await say($, text); await clock.advance(MIN) }
    expect(opened()).toBe(0)
  })

  test('insults.local.txt is read at session start and counts toward opening it', { timeoutMs: 30_000 }, async ($, on) => {
    const { clock, opened } = world(on, { insults: 'zorp\\w*' })
    await start($)
    for (let i = 0; i < 2; i++) { await say($, 'you zorp, total zorpface'); await clock.advance(30_000) }
    expect(opened()).toBe(1)
  })

  test('without insults.local.txt the same prompts score nothing', async ($, on) => {
    const { clock, opened } = world(on)
    await start($)
    for (let i = 0; i < 2; i++) { await say($, 'you zorp, total zorpface'); await clock.advance(30_000) }
    expect(opened()).toBe(0)
  })

  test('an hour of casual swearing, a prompt a minute, never builds up to it', async ($, on) => {
    const { clock, opened } = world(on)
    await start($)
    for (let i = 0; i < 60; i++) { await say($, 'fucking hell, that shit worked!! damn'); await clock.advance(MIN) }
    expect(opened()).toBe(0)
  })

  // Slow: the pane's 30 frames a second all run under the mock clock.
  test('a run of hot prompts opens the pane once, then the cooldown holds', { timeoutMs: 30_000 }, async ($, on) => {
    const { seen, clock } = world(on)
    await start($)
    for (const text of HOT) { await say($, text); await clock.advance(30_000) }
    expect(seen.panes).toEqual(['breathe'])
    for (const text of [...HOT, ...HOT]) { await say($, text); await clock.advance(30_000) }
    expect(seen.panes).toHaveLength(1)
    await clock.advance(61 * MIN)
    for (const text of HOT) { await say($, text); await clock.advance(30_000) }
    expect(seen.panes).toHaveLength(2)
  })

  test('heat fades: the same prompts spread over hours never add up', async ($, on) => {
    const { clock, opened } = world(on)
    await start($)
    for (const text of [...HOT, ...HOT]) { await say($, text); await clock.advance(90 * MIN) }
    expect(opened()).toBe(0)
  })

  test('hint mode shows a status hint instead, and clears it after five minutes', { options: { anger: 'hint' } }, async ($, on) => {
    const { seen, clock, opened } = world(on)
    await start($)
    for (const text of HOT) await say($, text)
    expect(opened()).toBe(0)
    expect(seen.status).toEqual(['rough one? /breathe'])
    await clock.advance(5 * MIN)
    expect(seen.status).toEqual(['rough one? /breathe', undefined])
  })

  test('off never scores', { options: { anger: 'off' } }, async ($, on) => {
    const { seen, opened } = world(on)
    await start($)
    for (const text of [...HOT, ...HOT]) await say($, text)
    expect(opened()).toBe(0)
    expect(seen.status).toEqual([])
  })

  test('hot text from the machinery (a background task finishing) is not the person', async ($, on) => {
    const { opened } = world(on)
    await start($)
    for (const text of [...HOT, ...HOT]) await say($, text, 'task-notification')
    expect(opened()).toBe(0)
  })

  test('the prompt goes on untouched', async ($, on) => {
    world(on)
    await start($)
    for (const text of HOT) expect((await say($, text)).text).toBe(text)
  })
})

describe('/breathe in the pane', () => {
  test('opens the pane with its drone, refuses a second, and closes itself after the breaths', async ($, on) => {
    const { seen, clock } = world(on)
    await start($)
    expect((await breathe($)).text).toMatch(/Esc at an empty prompt/)
    expect(seen.panes).toEqual(['breathe'])
    expect(seen.drones).toEqual([['-Pattern', '4-6', '-Cycles', '3', '-Volume', '0.35', '-StartedAt', '1000000000']])
    expect((await breathe($, 'box')).text).toBe('a breathing window is already open')
    await clock.advance(34_000) // 1.6 s settling in, three 10 s breaths, the goodbye still fading
    expect(seen.closes).toBe(0)
    await clock.advance(2_000)
    expect(seen.closes).toBe(1)
    expect(seen.kills).toBe(0) // the drone ends on its own
    await clock.advance(MIN)
    await breathe($, 'box')
    expect(seen.drones[1]).toEqual(['-Pattern', 'box', '-Cycles', '2', '-Volume', '0.35', '-StartedAt', String(clock.now())])
  })

  test('draws the sky, the words and a dot per breath', async ($, on) => {
    world(on)
    await start($)
    await breathe($)
    const ui = await $.ui.mount(PANE)
    const sky = await ui.find({ type: 'Raster', key: 'sky' })
    expect(sky?.props).toMatchObject({ columns: 80, rows: 16 })
    expect((await ui.find({ type: 'Text', text: /settle in/ }))?.text).toBe('settle in')
    expect((await ui.find({ type: 'Text', text: /·/ }))?.text).toBe('· · ·')
    await ui.unmount()
  })

  test('sound off: no drone', { options: { sound: false } }, async ($, on) => {
    const { seen } = world(on)
    await start($)
    await breathe($)
    expect(seen.panes).toHaveLength(1)
    expect(seen.drones).toEqual([])
  })

  test('a pane that cannot be placed opens the window instead', async ($, on) => {
    const { seen } = world(on, { placed: false })
    await start($)
    expect((await breathe($)).text).toMatch(/bottom-right/)
    expect(seen.closes).toBe(1)
    expect(seen.drones).toEqual([])
    expect(seen.launches[0]).toMatch(/\/ui\/breathe\.html\?p=4-6&s=30&v=0\.35$/)
  })

  test('off the terminal (the desktop app) it opens the window', async ($, on) => {
    const { seen } = world(on, { surfaces: ['desktop'] })
    await start($)
    await breathe($)
    expect(seen.panes).toEqual([])
    expect(seen.launches).toHaveLength(1)
  })

  test('an unknown pattern is refused with the choices', async ($, on) => {
    const { opened } = world(on)
    await start($)
    expect((await breathe($, 'fast')).text).toBe('breathe: pick 4-6, box, 4-7-8 or nothing')
    expect(opened()).toBe(0)
  })
})

describe('/breathe in the window', () => {
  test('opens with the set pattern, or the one asked for', { options: { where: 'window', sound: false } }, async ($, on) => {
    const { seen, clock } = world(on)
    await start($)
    const first = await breathe($)
    expect(first.text).toMatch(/bottom-right/)
    expect(seen.launches[0]).toMatch(/\?p=4-6&s=30&v=0$/)
    expect((await breathe($, 'box')).text).toBe('a breathing window is already open')
    await clock.advance(2 * MIN)
    await breathe($, 'box')
    expect(seen.launches[1]).toMatch(/\?p=box&/)
    expect(seen.panes).toEqual([])
  })

  test('the length setting reaches the window, in seconds', { options: { where: 'window', length: '2 min' } }, async ($, on) => {
    const { seen } = world(on)
    await start($)
    await breathe($)
    expect(seen.launches[0]).toMatch(/&s=120&/)
  })
})

describe('schedule', () => {
  test('off by default: hours pass and nothing opens', async ($, on) => {
    const { clock, opened } = world(on)
    await start($)
    await clock.advance(5 * 60 * MIN)
    expect(opened()).toBe(0)
  })

  test('every 30 min when set', { options: { schedule: '30 min' }, timeoutMs: 30_000 }, async ($, on) => {
    const { clock, opened } = world(on)
    await start($)
    await clock.advance(95 * MIN)
    expect(opened()).toBe(3)
  })
})
