import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CUE_MS } from '../hooks/cues'
import { THEMES } from '../themes'
import { engineHint, hintLine } from './hint'

// The world beneath the mod: tools answer ok or failed, toasts and sounds are recorded, the row under the
// prompt draws. A clip plays until `held` settles (at once by default).
const world = (on: On, held: Promise<void> = Promise.resolve()) => {
  const seen = { toasts: [] as string[], sounds: [] as string[], clock: mock.clock(on) }
  engineHint(on)
  on('fs.exists', ($, e) => ({ value: !/sounds[\\/](free|personal)[\\/]/.test(e.path) })) // voices built, no action packs
  on('tool.call', ($, e) => {
    const command = String((e as { command?: string }).command ?? '')
    if (command.includes('FAIL')) return { result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true }
    // `| tail` exits 0: only the summary says it failed
    if (command.includes('PIPED')) return { result: { stdout: ' Test Files  1 failed | 2 passed (3)', stderr: '', interrupted: false } }
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.toast', ($, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('process.run', async ($, e) => {
    seen.sounds.push(e.argv.join(' '))
    await held
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('audio.play', async ($, e) => { seen.sounds.push(JSON.stringify(e)); await held; return { value: undefined } })
  return seen
}

let turns = 0
const turn = async ($: Engine, answer: string, work: ($: Engine) => Promise<unknown> = async () => {}) => {
  const turnId = `t${++turns}`
  await $.turn.start({ text: 'do it', turnId })
  await work($)
  await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
}
const edit = ($: Engine, file_path = 'C:/repo/src/a.js') =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
const win = async ($: Engine) => { await edit($); await bash($, 'npx vitest run') }
// The mod's types have no timers (a mod has none); the test runner does.
const { setTimeout } = globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }
const settle = () => new Promise<void>(r => setTimeout(r, 50)) // lets an unawaited clip finish
const quiet = { sound: false }
// The win line under the prompt, once any action cue has run its time.
const winShown = async ($: Engine, seen: ReturnType<typeof world>) => { await seen.clock.advance(CUE_MS); return hintLine($) }

describe('tools mode', () => {
  test('an edit then a passing test run is a win, toasted with the rung', { options: { detect: 'tools', sound: false } }, async ($, on) => {
    const seen = world(on)
    await turn($, 'Done.', async $ => { await edit($); await bash($, 'npm test') })
    expect(seen.toasts).toEqual(['F I R S T   B L O O D'])
    expect(await winShown($, seen)).toBe('FIRST BLOOD · streak 1')
    expect(seen.sounds).toEqual([])
  })

  test('the spree climbs a rung each win, and a failed last check ends it', { options: { detect: 'tools', sound: false } }, async ($, on) => {
    const seen = world(on)
    for (const answer of ['one', 'two', 'three']) await turn($, answer, win)
    await turn($, 'broken', async $ => { await edit($); await bash($, 'npm test FAIL') })
    await turn($, 'fixed', win)
    expect(seen.toasts).toEqual(['F I R S T   B L O O D', 'K I L L I N G   S P R E E', 'R A M P A G E', 'F I R S T   B L O O D'])
  })

  test('no win without an edit, without a check, for scratch edits, or when a later check fails', { options: { detect: 'tools', ...quiet } }, async ($, on) => {
    const seen = world(on)
    await turn($, 'just ran tests', async $ => { await bash($, 'npm test') })
    await turn($, 'edited, never checked', async $ => { await edit($) })
    await turn($, 'scratch only', async $ => { await edit($, 'C:/Users/x/AppData/Local/Temp/claude/s/scratchpad/n.py'); await bash($, 'pytest') })
    await turn($, 'not a check', async $ => { await edit($); await bash($, 'ls test/') })
    await turn($, 'green then red', async $ => { await edit($); await bash($, 'npm test'); await bash($, 'npm run lint FAIL') })
    await turn($, 'piped red', async $ => { await edit($); await bash($, 'npx vitest run PIPED 2>&1 | tail') })
    expect(await winShown($, seen)).toBe('')
  })

  test("Claude's spaced call is ignored", { options: { detect: 'tools', ...quiet } }, async ($, on) => {
    const seen = world(on)
    await turn($, '**G O D L I K E**\n\nDone.')
    expect(await winShown($, seen)).toBe('')
  })

  test('the win line stays under the prompt, beside the engine hint', { options: { detect: 'tools', ...quiet } }, async ($, on) => {
    const seen = world(on)
    await turn($, 'Done.', win)
    await seen.clock.advance(60_000)
    expect(await hintLine($, '? for shortcuts')).toBe('? for shortcuts · FIRST BLOOD · streak 1')
  })
})

describe('marker mode', () => {
  test("Claude's own call plays alone, with no toast", { options: { detect: 'marker', sound: true } }, async ($, on) => {
    const seen = world(on)
    await turn($, '**M O N S T E R   K I L L**\n\nShipped the thing.')
    await settle()
    expect(seen.toasts).toEqual([])
    expect(await winShown($, seen)).toBe('MONSTER KILL · streak 1')
    expect(seen.sounds).toHaveLength(1)
    expect(seen.sounds[0]).toMatch(/monsterkill\.wav/)
  })

  test('a win while a clip plays stays silent; the next one after it plays', { options: { detect: 'marker', sound: true } }, async ($, on) => {
    let release = () => {}
    const seen = world(on, new Promise<void>(r => { release = r }))
    await turn($, '**H E A D S H O T**')
    await turn($, '**D O U B L E   K I L L**')
    expect(seen.sounds).toHaveLength(1)
    release()
    await settle()
    await turn($, '**M E G A   K I L L**')
    expect(seen.sounds.at(-1)).toMatch(/megakill\.wav/)
    expect(await winShown($, seen)).toBe('MEGA KILL · streak 3')
  })

  test('the volume setting reaches the player', { options: { detect: 'marker', sound: true, volume: '20%' } }, async ($, on) => {
    const seen = world(on)
    await turn($, '**H E A D S H O T**')
    expect(seen.sounds[0]).toMatch(/\* 0\.2\)|"gain":0\.2\b/)
  })

  test('an unknown call, or a rung Claude wrote itself, plays the rung actually reached', { options: { detect: 'marker', sound: true } }, async ($, on) => {
    const seen = world(on)
    await turn($, '**W I C K E D   S I C K**')
    await settle()
    await turn($, '**G O D L I K E**')
    expect(seen.sounds.join('\n')).toMatch(/firstblood\.wav[^]*killingspree\.wav/)
    expect(seen.sounds.join('\n')).not.toMatch(/godlike/)
  })

  test('plain bold and short caps are not calls; tool wins are ignored', { options: { detect: 'marker', ...quiet } }, async ($, on) => {
    const seen = world(on)
    await turn($, '**Done** and **A B** fine', async $ => { await edit($); await bash($, 'npm test') })
    expect(await winShown($, seen)).toBe('')
  })

  test("another voice's call plays from its own folder", { options: { detect: 'marker', sound: true, theme: 'ut2004-female' } }, async ($, on) => {
    const seen = world(on)
    await turn($, '**D E N I E D**\n\nThat premise was wrong.')
    expect(seen.sounds[0]).toMatch(/sounds\/ut2004-female\/denied\.wav/)
  })
})

test('every call Claude can pick says when it fits, and is a call the mod can read back', () => {
  for (const theme of Object.values(THEMES)) {
    for (const c of theme.calls) {
      expect(`${theme.id} ${c.text} ${c.when}`).not.toContain('undefined')
      expect(c.text).toMatch(/^[A-Z]+( [A-Z]+)*$/)
      expect(c.text.replace(/ /g, '').length).toBeGreaterThanOrEqual(3)
    }
  }
})

test('both: one win per turn, by either', { options: { detect: 'both', sound: false } }, async ($, on) => {
  const seen = world(on)
  await turn($, '**H E A D S H O T**', async $ => { await edit($); await bash($, 'npm test') })
  expect(await winShown($, seen)).toBe('HEADSHOT · streak 1')
  await turn($, 'Docs only.', async $ => { await edit($); await bash($, 'cargo test') })
  expect(await winShown($, seen)).toBe('KILLING SPREE · streak 2')
  expect(seen.toasts).toEqual(['K I L L I N G   S P R E E'])
})
