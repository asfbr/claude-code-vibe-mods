import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ACTIONS, afterRun, beforeRun, failedOutput, isCheck } from '../hooks/actions'
import { CUES, CUE_MS, TICK_MS } from '../hooks/cues'
import { bandLine, bandRow, engineBand, engineHint } from './hint'

// The world beneath the mod: which clips exist, tools that pass or fail, and every clip played.
// The free pack minus `force`, so one test can show an action with no clip. `player` answers a clip's run;
// `voices`, the UT99 calls built by scripts/sounds.py.
const FREE = ['question', 'permission', 'edit', 'big-refactor', 'tests-fail', 'green-after-red', 'commit',
  'push', 'destructive', 'install', 'task-done', 'interrupted', 'subagent', 'background-done']
type Player = (command: string) => { exitCode: number; stderr: string } | { deny: string }
let clock: MockClock // the world's, moved by the cue tests
const world = (on: On, personal: string[] = [], player: Player = () => ({ exitCode: 0, stderr: '' }), voices = ['firstblood']) => {
  const clips = new Set([...FREE.map(a => `sounds/free/${a}.wav`), ...personal.map(a => `sounds/personal/${a}.wav`),
    ...voices.map(c => `sounds/ut99/${c}.wav`)])
  const played: string[] = []
  clock = mock.clock(on)
  engineHint(on)
  engineBand(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('fs.exists', ($, e) => ({ value: [...clips].some(c => e.path.replace(/\\/g, '/').endsWith(c)) }))
  on('tool.call', ($, e) => {
    const command = String((e as { command?: string }).command ?? '')
    if (command.includes('FAIL')) return { result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true }
    // `| tail` exits 0: only the summary says it failed
    if (command.includes('REJECTED')) return { result: { stdout: 'husky - pre-commit hook exited with code 1', stderr: '', interrupted: false } }
    if (command.includes('PIPED')) return { result: { stdout: '=== 1 failed, 4 passed in 0.5s ===', stderr: '', interrupted: false } }
    return { result: { stdout: command.includes('ROOT') ? '[main (root-commit) 1a2b3c] first' : command.includes('git commit') ? '[main 4d5e6f7] x' : 'ok', stderr: '', interrupted: false } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    played.push(/sounds\/[\w-]+\/[\w-]+\.wav/.exec(e.argv.join(' '))?.[0] ?? '?')
    const ran = player(e.argv.join(' '))
    if ('deny' in ran) return { deny: ran.deny }
    return { value: { ...ran, stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('audio.play', ($, e) => {
    played.push(JSON.stringify(e).match(/sounds\/[\w-]+\/[\w-]+\.wav/)?.[0] ?? '?')
    const ran = player('')
    return 'deny' in ran ? { deny: ran.deny } : { value: undefined }
  })
  return played
}

let turns = 0
// The mod's types have no timers (a mod has none); the test runner does.
const { setTimeout } = globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }
const settle = () => new Promise<void>(r => setTimeout(r, 30)) // lets an unawaited clip start and end
const turn = async ($: Engine, work: ($: Engine) => Promise<unknown>, answer = 'Done.') => {
  const turnId = `t${++turns}`
  await $.turn.start({ text: 'do it', turnId })
  await work($)
  await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
  await settle()
}
// Each step settles, as calls minutes apart do: one clip at a time drops what lands while one plays.
const bash = async ($: Engine, command: string) => { await $.tool.call({ tool: 'Bash', command }); await settle() }
const edit = async ($: Engine, file_path = 'C:/repo/a.js') => {
  await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }); await settle()
}
const quiet = { sound: false }

describe('which command is which action', () => {
  test('before a command runs: destructive over force over push over install', () => {
    expect(beforeRun('git push --force origin main')).toBe('destructive')
    expect(beforeRun('git push -f')).toBe('destructive')
    expect(beforeRun('rm -rf build')).toBe('destructive')
    expect(beforeRun('git reset --hard HEAD~1')).toBe('destructive')
    expect(beforeRun('git commit --no-verify -m x')).toBe('force')
    expect(beforeRun('npm install --force')).toBe('force')
    expect(beforeRun('git push origin main')).toBe('push')
    expect(beforeRun('git push --follow-tags')).toBe('push')
    expect(beforeRun('pip install requests')).toBe('install')
    expect(beforeRun('git status')).toBeUndefined()
  })

  test('quoted text is what a command says, not what it runs', () => {
    expect(isCheck('git commit -m "fix npm test flake"')).toBe(false)
    expect(isCheck('npm test -- -t "login"')).toBe(true)
    expect(beforeRun("echo 'never rm -rf /'")).toBeUndefined()
    expect(beforeRun('git commit -m "$(cat <<\'EOF\'\nstop git push --force\nEOF\n)"')).toBeUndefined()
    expect(afterRun('git commit -m "run npm test before git push"', true, '[main 1a2b] x')).toBe('commit')
  })

  test("a check's summary says it failed; zero counts and lint warnings do not", () => {
    for (const out of [' Test Files  2 failed | 7 passed (9)', '1 failed, 1 warning in 4.65s', ' FAIL  src/a.test.ts',
      'FAILED backend/tests/test_x.py::t', 'a.tsx(6,28): error TS2305: x', 'Found 13 errors.', '✖ 3 problems (1 error, 2 warnings)',
      '  2 failing', 'test result: FAILED. 1 passed; 1 failed']) expect(failedOutput(out)).toBe(true)
    for (const out of ['Tests  7 passed (7)', '0 failed', 'Found 0 errors.', '✖ 4 problems (0 errors, 4 warnings)', 'All checks passed!'])
      expect(failedOutput(out)).toBe(false)
  })

  test('after: a commit git printed, a root or detached one, or a quiet one; not one a hook rejected', () => {
    expect(afterRun('git commit -m x', true, '[detached HEAD 1a2b3c4] x')).toBe('commit')
    expect(afterRun('git commit -q -m x', true, '\n')).toBe('commit')
    expect(afterRun('git commit -m x 2>&1 | tail', true, 'husky - pre-commit hook exited with code 1')).toBeUndefined()
    expect(afterRun('git commit -m x', true, '[main 1a2b] x')).toBe('commit')
    expect(afterRun('git commit -m x', true, '[main (root-commit) 1a2b] x')).toBe('commit')
    expect(afterRun('git commit -m x', false, '')).toBeUndefined()
  })
})

describe('action sounds', () => {
  test('a question, a subagent and a permission dialog each sound', { options: { ...quiet, subagents: true } }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => {
      await $.tool.call({ tool: 'AskUserQuestion', questions: [] }); await settle()
      await $.tool.call({ tool: 'Agent', prompt: 'look', description: 'look' }); await settle()
      await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } }); await settle()
    })
    expect(played).toEqual(['sounds/free/question.wav', 'sounds/free/subagent.wav', 'sounds/free/permission.wav'])
  })

  test('the edit sound plays once a turn; the tenth file is a big refactor', { options: quiet }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { for (let i = 0; i < 12; i++) await edit($, `C:/repo/f${i}.js`) })
    await turn($, async $ => { await edit($) })
    expect(played).toEqual(['sounds/free/edit.wav', 'sounds/free/big-refactor.wav', 'sounds/free/edit.wav'])
  })

  test('a failed check, then green after red, across turns', { options: quiet }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await bash($, 'npm test FAIL'); await bash($, 'npm test FAIL') })
    await turn($, async $ => { await bash($, 'npm test'); await bash($, 'npm test') })
    expect(played).toEqual(['sounds/free/tests-fail.wav', 'sounds/free/green-after-red.wav'])
  })

  test('a piped check that exits 0 fails by its summary', { options: quiet }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await bash($, 'pytest PIPED 2>&1 | tail -5') })
    await turn($, async $ => { await bash($, 'pytest 2>&1 | tail -5') })
    expect(played).toEqual(['sounds/free/tests-fail.wav', 'sounds/free/green-after-red.wav'])
  })

  test('commits (a first one alike, not one a hook rejected), pushes and a force push', { options: quiet }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => {
      await bash($, 'git commit -m ROOT'); await bash($, 'git commit -m REJECTED 2>&1 | tail'); await bash($, 'git commit -m x')
      await bash($, 'git push'); await bash($, 'git push --force')
    })
    expect(played).toEqual(['sounds/free/commit.wav', 'sounds/free/commit.wav', 'sounds/free/push.wav', 'sounds/free/destructive.wav'])
  })

  test("a subagent's own calls make no sound", { options: quiet }, async ($, on) => {
    const played = world(on)
    const inSubagent = { tool: 'Bash', command: 'git push', agentId: 'a1' } as never // agentId is the engine's to set
    await turn($, async $ => { await $.tool.call(inSubagent); await settle() })
    expect(played).toEqual([])
  })

  test('an interrupted turn sounds; with the call muted, the win sounds task-done', { options: quiet }, async ($, on) => {
    const played = world(on)
    await $.turn.start({ text: 'go', turnId: 'x1' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 'x1', reason: 'aborted' })
    await settle()
    await turn($, async $ => { await edit($); await bash($, 'npm test') })
    expect(played).toEqual(['sounds/free/interrupted.wav', 'sounds/free/edit.wav', 'sounds/free/task-done.wav'])
  })

  test("with the call's sound on, the win plays the call and no task-done", { options: { sound: true, detect: 'tools' } }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await edit($); await bash($, 'npm test') })
    expect(played).toEqual(['sounds/free/edit.wav', 'sounds/ut99/firstblood.wav'])
  })

  test('with the game voices not built, the win sounds task-done', { options: { sound: true, detect: 'tools' } }, async ($, on) => {
    const played = world(on, [], undefined, [])
    await turn($, async $ => { await edit($); await bash($, 'npm test') })
    expect(played).toEqual(['sounds/free/edit.wav', 'sounds/free/task-done.wav'])
  })

  test('personal clips first, the free one where there is none, variants in turn', { options: { ...quiet, actions: 'personal' } }, async ($, on) => {
    const played = world(on, ['question', 'question-2'])
    for (let i = 0; i < 3; i++) await turn($, async $ => { await $.tool.call({ tool: 'AskUserQuestion', questions: [] }); await settle() })
    await turn($, async $ => { await bash($, 'git push') })
    expect(played).toEqual(['sounds/personal/question.wav', 'sounds/personal/question-2.wav', 'sounds/personal/question.wav', 'sounds/free/push.wav'])
  })

  test('an action set off stays silent', { options: { ...quiet, push: 'off', question: 'off' } }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await bash($, 'git push'); await $.tool.call({ tool: 'AskUserQuestion', questions: [] }); await bash($, 'pip install x') })
    expect(played).toEqual(['sounds/free/install.wav'])
  })

  test("an action's own pack overrides the default, either way", { options: { ...quiet, actions: 'personal', push: 'free', install: 'off' } }, async ($, on) => {
    const played = world(on, ['push', 'commit'])
    await turn($, async $ => { await bash($, 'git push'); await bash($, 'git commit -m x'); await bash($, 'pip install x') })
    expect(played).toEqual(['sounds/free/push.wav', 'sounds/personal/commit.wav'])
  })

  test('off is silent', { options: { ...quiet, actions: 'off' } }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await bash($, 'git push'); await edit($) })
    expect(played).toEqual([])
  })

  test('an action with no clip in any pack is silent', { options: quiet }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await bash($, 'git commit --no-verify -m x') })
    expect(played).toEqual(['sounds/free/commit.wav']) // force has no free clip; the commit still sounds
  })

  test('/announcer play names the clip; list shows every action', { options: quiet }, async ($, on) => {
    world(on)
    const run = (args: string) => $.command.run({ command: 'announcer', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect((await run('play push')).text).toBe('push: sounds/free/push.wav')
    expect((await run('push')).text).toBe('push: sounds/free/push.wav')
    expect((await run('play force')).text).toBe('force: no clip in the free pack')
    expect((await run('nope')).text).toMatch(/^no action "nope"\. \/announcer list, or/)
    expect((await run('list')).text).toMatch(/^Action sounds \[pack\] \(default free[^\n]*\nquestion \[free\]: Claude asks you[^\n]* → free\/question\.wav\n[^]*force \[free\]: [^\n]* → silent, no clip/)
  })

  test('/announcer play waits for the clip and says when it could not play', { options: quiet }, async ($, on) => {
    let answer: ReturnType<Player> = { exitCode: 1, stderr: 'The wave header is corrupt.' }
    const played = world(on, [], () => answer)
    const run = (args: string) => $.command.run({ command: 'announcer', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const failed = (await run('push')).text
    expect(played).toEqual(['sounds/free/push.wav'])
    expect(failed).toMatch(/^push: sounds\/free\/push\.wav, did not play: /)
    answer = { deny: 'no audio device' }
    expect((await run('commit')).text).toMatch(/^commit: sounds\/free\/commit\.wav, did not play: .*no audio device/)
  })

  // Windows' microphone-use registry: the player exits 3 when an app is using the mic now.
  const onCall: Player = command => ({ exitCode: command.includes('microphone') && command.includes('exit 3') ? 3 : 0, stderr: '' })
  const run = ($: Engine, args: string) => $.command.run({ command: 'announcer', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  const row = ($: Engine, key: string, label: string) =>
    $.config.describe({ key, label, isHidden: false, provider: { plugin: 'announcer' } } as never)

  test("an action's /config row names the pack its default stands for; other rows are left alone", { options: { ...quiet, actions: 'personal', each_action: true } }, async ($, on) => {
    world(on)
    on('config.describe', ($, e) => ({ label: e.label, isHidden: false }))
    expect(await row($, 'announcer.big_refactor', 'Action: big-refactor')).toEqual({ label: 'Action: big-refactor (default = personal)', isHidden: false })
    expect((await row($, 'announcer@inline.push', 'Action: push')).label).toBe('Action: push (default = personal)')
    expect((await row($, 'announcer.volume', 'Volume')).label).toBe('Volume')
  })

  test("the action rows hide until 'one row each' is on, and still apply hidden", { options: { ...quiet, push: 'off' } }, async ($, on) => {
    const played = world(on)
    on('config.describe', ($, e) => ({ label: e.label, isHidden: false }))
    expect((await row($, 'announcer.push', 'Action: push')).isHidden).toBe(true)
    expect((await row($, 'announcer.volume', 'Volume')).isHidden).toBe(false)
    await turn($, async $ => { await bash($, 'git push') })
    expect(played).toEqual([])
    expect((await run($, 'list')).text).toMatch(/set one in \/config, with 'Action sounds: one row each' on\)/)
  })

  test('spacing: an action sounds again only once its gap has passed; its cue still shows', { options: { ...quiet, spacing: '5 min' } }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await edit($) })
    await clock.advance(2 * 60_000)
    await turn($, async $ => { await edit($); await bash($, 'git push') })
    expect(await bandLine($)).toMatch(/push/)
    await clock.advance(2 * 60_000)
    await turn($, async $ => { await edit($) })
    expect(await bandLine($)).toMatch(/edit {2}a\.js/)
    await clock.advance(2 * 60_000)
    await turn($, async $ => { await edit($) })
    expect(played).toEqual(['sounds/free/edit.wav', 'sounds/free/push.wav', 'sounds/free/edit.wav'])
  })

  test('spacing never holds back what waits on you or warns you', { options: { ...quiet, spacing: '15 min' } }, async ($, on) => {
    const played = world(on)
    for (let i = 0; i < 2; i++) {
      await turn($, async $ => {
        await $.tool.call({ tool: 'AskUserQuestion', questions: [] }); await settle()
        await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } }); await settle()
        await bash($, 'rm -rf build'); await bash($, 'git push')
      })
    }
    expect(played).toEqual(['sounds/free/question.wav', 'sounds/free/permission.wav', 'sounds/free/destructive.wav', 'sounds/free/push.wav',
      'sounds/free/question.wav', 'sounds/free/permission.wav', 'sounds/free/destructive.wav'])
  })

  test('on a call (the microphone in use) clips stay silent, and the audition says why', { options: quiet }, async ($, on) => {
    world(on, [], onCall)
    expect((await run($, 'push')).text).toMatch(/did not play: silent: the microphone is in use/)
  })

  test('with `calls` off, the microphone is not checked', { options: { ...quiet, calls: false } }, async ($, on) => {
    world(on, [], onCall)
    expect((await run($, 'push')).text).toBe('push: sounds/free/push.wav')
  })
})

// A background task's notification, as the session queues it.
const notify = ($: Engine, summary: string) => $.prompt.submit({
  text: `<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`,
  wait: false, origin: { kind: 'task-notification' },
})
const fromSubagent = { tool_name: 'Bash', tool_input: { command: 'rm x' }, agent_id: 'a1' } as never // the engine's to set

describe('subagents', () => {
  test("off: a spawn and an agent's end are silent; a command's end and a subagent's permission still sound", { options: quiet }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await $.tool.call({ tool: 'Agent', prompt: 'look', description: 'look' }); await settle() })
    await notify($, 'Agent "look" finished'); await settle()
    await notify($, 'Agent "look" was stopped by Claude'); await settle()
    await notify($, 'Background command "npm run build" completed (exit code 0)'); await settle()
    await $.classic.PermissionRequest(fromSubagent); await settle()
    expect(played).toEqual(['sounds/free/background-done.wav', 'sounds/free/permission.wav'])
  })

  test("on: a spawn and an agent's end sound", { options: { ...quiet, subagents: true } }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await $.tool.call({ tool: 'Agent', prompt: 'look', description: 'look' }); await settle() })
    await notify($, 'Agent "look" finished'); await settle()
    expect(played).toEqual(['sounds/free/subagent.wav', 'sounds/free/background-done.wav'])
  })
})

describe('cues', () => {
  test('every action has a motion of at least three frames, each five cells', () => {
    for (const action of ACTIONS) {
      expect(CUES[action].frames.length).toBeGreaterThanOrEqual(3)
      for (const frame of CUES[action].frames) expect(`${action} ${[...frame].length}`).toBe(`${action} 5`)
    }
  })

  test('a cue names its action and trigger in its colour, steps its frames, and is gone after its time', { options: quiet }, async ($, on) => {
    world(on)
    await turn($, async $ => { await bash($, 'git push origin main') })
    const first = await bandRow($)
    expect(first.text).toBe(`${CUES.push.frames[0]} push  git push origin main`)
    expect(first.colors).toContain(CUES.push.color)
    await clock.advance(TICK_MS)
    expect(await bandLine($)).toBe(`${CUES.push.frames[1]} push  git push origin main`)
    expect(await bandLine($, true)).toBe('') // a survey holds the band
    await clock.advance(CUE_MS)
    expect(await bandLine($)).toBe('')
  })

  test("a new cue replaces the one on screen, and the old one's timer never cuts it short", { options: quiet }, async ($, on) => {
    world(on)
    await turn($, async $ => { await bash($, 'git push') })
    await clock.advance(1000)
    await turn($, async $ => { await bash($, 'git commit -m "long message that goes on and on past the forty-eight cells"') })
    expect(await bandLine($)).toMatch(/^.{5} commit {2}git commit -m "long message that goes on and on…$/)
    await clock.advance(2000)
    expect(await bandLine($)).toMatch(/ commit /)
    await clock.advance(1000)
    expect(await bandLine($)).toBe('')
  })

  test('an action set off gets no cue', { options: { ...quiet, push: 'off' } }, async ($, on) => {
    world(on)
    await turn($, async $ => { await bash($, 'git push') })
    expect(await bandLine($)).toBe('')
  })

  test('cues off: the sound plays, nothing shows', { options: { ...quiet, cues: false } }, async ($, on) => {
    const played = world(on)
    await turn($, async $ => { await bash($, 'git push') })
    expect(played).toEqual(['sounds/free/push.wav'])
    expect(await bandLine($)).toBe('')
  })

  test('/announcer <action> shows its cue while it plays', { options: quiet }, async ($, on) => {
    world(on)
    await $.command.run({ command: 'announcer', args: 'install', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(await bandLine($)).toBe(`${CUES.install.frames[0]} install  audition`)
  })
})
