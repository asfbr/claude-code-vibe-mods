import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { THEMES } from '../themes'
import type { Call, Theme } from '../themes'
import type { ShownCue, WinLine } from '../types'
import { ACTIONS, WHEN, afterRun, beforeRun, failedOutput, isCheck } from './actions'
import type { Action } from './actions'
import { CUES, CUE_MS, TICK_MS, base, cut } from './cues'

const streak = atom({ plugin: 'announcer', key: 'streak' } as const, 0)
const shown = atom({ plugin: 'announcer', key: 'cue' } as const, null as ShownCue | null)
const winLine = atom({ plugin: 'announcer', key: 'win' } as const, null as WinLine | null)

const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELLS = new Set(['Bash', 'PowerShell'])
const QUESTIONS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const SPAWNS = new Set(['Agent', 'Task'])
// A subagent's end notification; a background command's reads `Background command "…"`, a monitor's `Monitor "…"`.
const AGENT_DONE = /<summary>Agent "/
const BIG = 10 // distinct files edited in one turn that make it a big refactor
const THROWAWAY = /[\\/](scratchpad|temp|tmp)[\\/]/i
// Claude's own call in its answer, e.g. **U N S T O P P A B L E**.
const SPOKEN = /\*\*\s*([A-Z](?: +[A-Z]){2,})\s*\*\*/g

const squash = (text: string) => text.replace(/\s+/g, '')
const spaced = (text: string) => text.split(' ').map(w => w.split('').join(' ')).join('   ')

// The call Claude wrote: one of the theme's calls, `true` for any other (a rung included), else undefined.
const spoken = (answer: string, theme: Theme): Call | true | undefined => {
  const said = [...answer.matchAll(SPOKEN)].map(m => squash(m[1] ?? ''))
  if (said.length === 0) return undefined
  return theme.calls.find(c => said.includes(squash(c.text))) ?? true
}

// The streak's rung: FIRST BLOOD at the first win, one up per win, the last repeating.
const rung = (theme: Theme, n: number) => theme.spree[Math.min(n, theme.spree.length) - 1]!

// One clip at a time. An action sound while one plays is dropped; a win waits for an action's clip to end,
// and a win while another win plays stays silent rather than talking over it.
let playing: Promise<unknown> | undefined
let winPlaying = false
let quietOnMic = true // the `calls` setting
// Windows lists each app's microphone use; a LastUsedTimeStop of 0 is one using it now (a call, dictation).
const MIC = `if (Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.GetValue('LastUsedTimeStop') -eq 0 }) { exit 3 }; `
const MIC_IN_USE = 3
// Resolves undefined once the clip played, else why it did not: a clip that cannot play never fails the turn.
const play = async ($: EngineInterface, asset: string, volume: number): Promise<string | undefined> => {
  try {
    if (!/^[A-Za-z]:[\\/]/.test($.plugin.root)) return void await $.audio.play({ asset }, { gain: volume })
    // Windows: the engine's player is silent there, and WPF's MediaPlayer never learns a clip's length in a
    // console (no message loop), so SoundPlayer plays it whole, the 8-bit samples scaled for volume first.
    const path = `${$.plugin.root}/${asset}`.replace(/'/g, "''")
    const scale = volume >= 1 ? '' : `for ($i = 44; $i -lt $b.Length; $i++) { $b[$i] = [byte](128 + [int](($b[$i] - 128) * ${volume})) }; `
    const ran = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
      `${quietOnMic ? MIC : ''}$b = [IO.File]::ReadAllBytes('${path}'); ${scale}(New-Object Media.SoundPlayer([IO.MemoryStream]::new($b))).PlaySync()`],
    { timeoutMs: 60_000 })
    if (ran.exitCode === MIC_IN_USE) return 'silent: the microphone is in use (a call?)'
    return ran.exitCode === 0 ? undefined : `powershell exit ${ran.exitCode}: ${cut(ran.stderr || ran.stdout || 'no output', 300)}`
  } catch (err) {
    return cut(err instanceof Error ? err.message : String(err), 300)
  }
}
// False when dropped, another clip playing.
const playAction = ($: EngineInterface, asset: string, volume: number) => {
  if (playing) return false
  playing = play($, asset, volume).finally(() => { playing = undefined })
  return true
}
const playWin = async ($: EngineInterface, asset: string, volume: number) => {
  if (winPlaying) return
  winPlaying = true
  try {
    await playing
    playing = play($, asset, volume).finally(() => { playing = undefined })
    await playing
  } finally {
    winPlaying = false
  }
}

type Choice = 'free' | 'personal' | 'off'
type Pack = {
  fallback: Choice // the `actions` setting, for every action left on `default`
  choice: Record<Action, Choice> // each action's own setting, `default` resolved
  volume: number
  found: Map<Action, string[]>
  played: Map<Action, number>
  heard: Set<Action> // once-per-turn actions already sounded this turn
  spacing: number // the `spacing` setting: an action sounds again only this long after it last did
  soundedAt: Map<Action, number>
  cues: boolean
  cueMs: number // the `cue_duration` setting: how long a cue stays on screen
  timer?: Timer // the cue on screen's frames
  shownId: number
}

// An action's clips: personal first when that pack is chosen (it is gitignored, so it may be missing),
// else the free pack; `<action>-2` a variant played in turn. None for an action no pack has. An action set
// off still has the clips it would play, for `/announcer play`.
async function clips($: EngineInterface, pack: Pack, action: Action) {
  const cached = pack.found.get(action)
  if (cached) return cached
  const from = async (folder: string) => {
    const ids = [`sounds/${folder}/${action}.wav`, `sounds/${folder}/${action}-2.wav`]
    const ok = await Promise.all(ids.map(id => $.fs.exists(`${$.plugin.root}/${id}`).catch(() => false)))
    return ids.filter((_, i) => ok[i])
  }
  const chosen = pack.choice[action] === 'off' ? pack.fallback : pack.choice[action]
  const personal = chosen === 'personal' ? await from('personal') : []
  const list = personal.length > 0 ? personal : await from('free')
  pack.found.set(action, list)
  return list
}

async function clipFor($: EngineInterface, pack: Pack, action: Action) {
  const list = await clips($, pack, action)
  const n = pack.played.get(action) ?? 0
  pack.played.set(action, n + 1)
  return list[n % Math.max(1, list.length)]
}

// Shows an action's cue above the prompt for the `cue_duration` setting, replacing the one on screen; a timer
// steps its frames and stops with it, so nothing runs while idle.
async function cue($: EngineInterface, pack: Pack, action: Action, detail: string) {
  if (!pack.cues) return
  pack.timer?.cancel()
  const id = ++pack.shownId
  let frame = 0
  try {
    await update($, shown, () => ({ id, action, detail: cut(detail), frame }))
    const timer = $.clock.every(TICK_MS, () => {
      frame += 1
      const done = frame * TICK_MS >= pack.cueMs
      if (done) timer.cancel()
      void update($, shown, c => c?.id !== id ? c : done ? null : { ...c, frame })
    })
    pack.timer = timer
  } catch {
    await update($, shown, () => null).catch(() => {}) // a cue that cannot animate never stays frozen
  }
}

// These wait on you or warn you, so they sound every time, whatever `spacing` says.
const UNSPACED = new Set<Action>(['question', 'permission', 'force', 'destructive', 'task-done'])

// The action's clip, then its cue: an action dropped while another clip plays, or too soon after its last
// sound (`spacing`), still shows, replacing that cue.
async function sound($: EngineInterface, pack: Pack, action: Action, detail = '', once = false) {
  if (pack.choice[action] === 'off' || (once && pack.heard.has(action))) return
  pack.heard.add(action)
  const now = await $.clock.now()
  const soon = !UNSPACED.has(action) && now - (pack.soundedAt.get(action) ?? -Infinity) < pack.spacing
  const clip = soon ? undefined : await clipFor($, pack, action)
  if (clip !== undefined && playAction($, clip, pack.volume)) pack.soundedAt.set(action, now)
  await cue($, pack, action, detail)
}

export const register: Register = (on, options) => {
  const theme = THEMES[String(options.theme)] ?? THEMES.ut99!
  const detect = String(options.detect)
  const volume = Math.min(100, parseInt(String(options.volume), 10) || 35) / 100 // "35%" → 0.35
  const fallback = String(options.actions ?? 'free') as Choice
  const own = (a: Action) => String(options[a.replace(/-/g, '_')] ?? 'default') // setting keys take no hyphens
  const choice = Object.fromEntries(ACTIONS.map(a => [a, own(a) === 'default' ? fallback : own(a)])) as Record<Action, Choice>
  const cues = options.cues !== false
  const cueMs = parseInt(String(options.cue_duration), 10) * 1000 || CUE_MS // "6 sec" → 6000
  const subagents = options.subagents === true // a subagent's spawn and its end notification sound too
  quietOnMic = options.calls !== false
  const spacing = (parseInt(String(options.spacing), 10) || 0) * 60_000 // "5 min" → 300000; "any time" → 0
  const eachAction = options.each_action === true // the per-action rows show in /config
  const pack: Pack = { fallback, choice, volume, found: new Map(), played: new Map(), heard: new Set(), spacing,
    soundedAt: new Map(), cues, cueMs, shownId: 0 }
  let edited = false
  let check: boolean | undefined // the last check of the turn: passed, failed, or none ran
  let lastCheck: boolean | undefined // the last check of any turn, for green after red
  let files = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'announcer',
      description: "List what each action sound fires on, or hear one",
      argumentHint: 'list | <action>',
      immediate: true,
    })
    await update($, shown, () => null) // a reload stops a cue's timer mid-way; never leave it frozen on screen
    return next(e)
  })

  // Each action's /config row says what its `default` stands for now: the `actions` setting's pack. The 17
  // rows show only with `each_action` on; hidden, they still apply and still answer /config key=value.
  on('config.describe', async ($, e, next) => {
    const field = /^announcer(?:@[\w-]+)?\.(\w+)$/.exec(e.key)?.[1]
    const shown = await next(e)
    if (field === undefined || !ACTIONS.includes(field.replace(/_/g, '-') as Action)) return shown
    return { ...shown, label: `${shown.label} (default = ${fallback})`, isHidden: shown.isHidden || !eachAction }
  })

  // Under the prompt, below the custom status line: the last win's line, dim at the hint row's end.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const win = await read($, winLine)
    return win === null || e.surface !== 'terminal' ? next(e) : next({ ...e, props: { ...e.props, tail: win } })
  })

  // The cue: one line directly above the prompt, while its sound plays. The hint row under the status line
  // is not drawn while a custom status line is set, so a cue there never showed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, shown)
    if (now === null || e.props.hasSurvey) return next(e)
    const look = CUES[now.action as Action]
    if (look === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color={look.color}>{look.frames[now.frame % look.frames.length]} {now.action}</Text>
        <Text dimColor wrap="truncate">{now.detail === '' ? '' : `  ${now.detail}`}</Text>
      </Box>
    )
  })

  on('command.run', { command: 'announcer' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/)
    const [verb, name] = words.length === 1 && ACTIONS.includes(words[0] as Action) ? ['play', words[0]] : words // `/announcer push` plays it
    if (verb === 'play' && ACTIONS.includes(name as Action)) {
      const action = name as Action
      const clip = await clipFor($, pack, action)
      await cue($, pack, action, 'audition')
      if (clip === undefined) return { text: `${name}: no clip in the ${pack.choice[action] === 'personal' ? 'personal or free' : 'free'} pack` }
      const failed = await play($, clip, volume) // awaited, so a clip that cannot play says why
      const off = pack.choice[action] === 'off' ? ' (set off: silent when it happens)' : ''
      return { text: `${name}: ${clip}${off}${failed === undefined ? '' : `, did not play: ${failed}`}` }
    }
    if (verb === 'list') {
      const rows = await Promise.all(ACTIONS.map(async a => {
        const files = (await clips($, pack, a)).map(f => f.replace(/^sounds\//, '')).join(', ')
        return `${a} [${pack.choice[a]}]: ${WHEN[a]} → ${pack.choice[a] === 'off' ? 'off' : files || 'silent, no clip'}`
      }))
      const where = eachAction ? 'its own row in /config' : "/config, with 'Action sounds: one row each' on"
      const gap = spacing > 0 ? `; each sounds again ${spacing / 60_000} min after it last did, but ${[...UNSPACED].join(', ')}` : ''
      return { text: `Action sounds [pack] (default ${pack.fallback}; set one in ${where}${gap}), when → clip:\n${rows.join('\n')}` }
    }
    const asked = e.args.trim() === '' ? '' : `no action "${name ?? verb}". `
    return { text: `${asked}/announcer list, or /announcer <action> to hear one: ${ACTIONS.join(', ')}` }
  })

  // A subagent's permission dialog sounds too, whatever `subagents` says: it waits on you.
  on('classic.PermissionRequest', async ($, e, next) => {
    const input = (e.tool_input ?? {}) as { command?: string; file_path?: string }
    await sound($, pack, 'permission', `${e.tool_name} ${input.command ?? (input.file_path ? base(input.file_path) : '')}`)
    return next(e)
  })
  // The classic event, not `session.compact`: the managed `cc-plugin-sec-default` skips user-tier hooks on that one.
  on('classic.PostCompact', async ($, e, next) => {
    if (e.agent_id === undefined) await sound($, pack, 'compacted', e.trigger)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    if ((e.origin as { kind?: string } | undefined)?.kind === 'task-notification' && (subagents || !AGENT_DONE.test(e.text))) {
      await sound($, pack, 'background-done', /<summary>([^<]*)<\/summary>/.exec(e.text)?.[1] ?? '')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) { edited = false; check = undefined; files = new Set(); pack.heard = new Set() }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const main = e.agentId === undefined // a subagent's own calls make no sound
    const input = e as unknown as {
      file_path?: string; notebook_path?: string; command?: string; run_in_background?: boolean
      description?: string; questions?: { question?: string }[]
    }
    const command = input.command ?? ''
    if (main && QUESTIONS.has(tool)) await sound($, pack, 'question', tool === 'ExitPlanMode' ? 'a plan to approve' : input.questions?.[0]?.question ?? '')
    if (main && subagents && SPAWNS.has(tool)) await sound($, pack, 'subagent', input.description ?? '')
    if (main && SHELLS.has(tool)) { const a = beforeRun(command); if (a) await sound($, pack, a, command) }
    const ran = await next(e)
    const isOk = ran.deny === undefined && ran.isError !== true
    if (EDITS.has(tool)) {
      const path = input.file_path ?? input.notebook_path ?? ''
      if (isOk && !THROWAWAY.test(path)) {
        edited = true
        files.add(path)
        if (main) await sound($, pack, files.size >= BIG ? 'big-refactor' : 'edit', files.size >= BIG ? `${files.size} files this turn` : base(path), true)
      } else if (main && ran.deny === undefined && ran.isError === true) await sound($, pack, 'tool-error', `${tool} ${base(path)}`, true)
    } else if (SHELLS.has(tool)) {
      const result = ran.result as { stdout?: string; stderr?: string; interrupted?: boolean } | undefined
      if (isCheck(command) && !input.run_in_background) {
        check = isOk && result?.interrupted !== true && !failedOutput(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`)
        if (main && check === false) await sound($, pack, 'tests-fail', command, true)
        else if (main && lastCheck === false) await sound($, pack, 'green-after-red', command, true)
        lastCheck = check
      } else if (main && !input.run_in_background) {
        const a = afterRun(command, isOk, `${result?.stdout ?? ''}
${result?.stderr ?? ''}`)
        if (a) await sound($, pack, a, command)
      }
    } else if (main && tool.startsWith('mcp__') && ran.deny === undefined && ran.isError === true) {
      await sound($, pack, 'tool-error', tool.replace(/^mcp__/, ''), true)
    }
    return ran
  }).catch(($, e, next) => next(e)) // only watches: a failure here never blocks the tool

  // One win, one clip: Claude's own call, else the streak's rung. Claude's call line stays in its reply.
  // With the call's sound off, the action pack's task-done sounds the win instead.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.isAborted) { await sound($, pack, 'interrupted', 'you stopped the turn'); return next(e) }
    if (detect === 'off' || e.reason === 'error' || e.reason === 'refusal') return next(e) // a dead turn is no win
    const said = detect === 'tools' ? undefined : spoken(e.answer, theme)
    const earned = detect !== 'marker' && edited && check === true
    if (said === undefined && !earned) {
      if (detect !== 'marker' && check === false) await update($, streak, () => 0) // a failed check ends the spree
      return next(e)
    }
    const n = await update($, streak, s => s + 1)
    const call = (typeof said === 'object' ? said : undefined) ?? rung(theme, n)
    await update($, winLine, () => `${call.text} · streak ${n}`) // drawn under the prompt (PromptHint above)
    if (said === undefined) $.ui.toast(spaced(call.text), { timeoutMs: 6000 }) // nothing in the reply shows it
    // The game voices are built locally (scripts/sounds.py); until then the win sounds task-done.
    const voice = `sounds/${theme.id}/${call.clip}.wav`
    const built = options.sound === true && await $.fs.exists(`${$.plugin.root}/${voice}`).catch(() => false)
    if (built) void playWin($, voice, volume)
    else await sound($, pack, 'task-done', call.text)
    return next(e)
  })
}
