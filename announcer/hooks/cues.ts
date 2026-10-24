import type { Action } from './actions'

// The visual cue each action sound gets: a few-frame motion five cells wide, in its family's theme colour.
// Families share a colour; checks and turn ends take their outcome's (success / error) instead.
export type Cue = { color: string; frames: readonly string[] }

const SESSION = 'ide'
const ASKS = 'permission'
const WORK = 'claude'
const GIT = 'merged'

export const CUES: Record<Action, Cue> = {
  compacted: { color: SESSION, frames: ['◀   ▶', ' ◀ ▶ ', '  ◆  ', '  ◆  '] }, // walls close in
  'background-done': { color: SESSION, frames: ['    ●', '   ● ', '  ●  ', ' ●   ', '●    '] }, // comes back to you
  question: { color: ASKS, frames: ['  ?  ', ' ‹?› ', '‹ ? ›', ' ‹?› '] }, // pulses at you
  permission: { color: ASKS, frames: ['▐███▌', '▐█ █▌', '▐   ▌', '▐█ █▌'] }, // a gate, waiting to open
  subagent: { color: WORK, frames: ['  ●  ', ' ●○  ', ' ● ○ ', '●   ○', '●    '] }, // sends one out
  edit: { color: WORK, frames: ['▏    ', '━▏   ', '━━▏  ', '━━━▏ ', '━━━━▏'] }, // a pen writes a line
  'big-refactor': { color: WORK, frames: ['▚▞▚▞▚', '▞▚▞▚▞', '▙▟▙▟▙', '▛▜▛▜▛'] }, // blocks reshuffle
  install: { color: WORK, frames: ['▱▱▱▱▱', '▰▱▱▱▱', '▰▰▱▱▱', '▰▰▰▱▱', '▰▰▰▰▱', '▰▰▰▰▰'] }, // a bar fills
  'tests-fail': { color: 'error', frames: ['  ╳  ', ' ╳ ╳ ', '╳ ╳ ╳', ' ╳ ╳ '] }, // crosses flash
  'green-after-red': { color: 'success', frames: ['╳    ', '╳ ›  ', '╳ › ›', '    ✓', '  ✓  '] }, // red, then through
  'tool-error': { color: 'error', frames: ['░▒▓▒░', '▒▓░▓▒', '▓░▒░▓'] }, // static
  commit: { color: GIT, frames: ['──○──', '──◎──', '──●──', '──●──'] }, // a node fills on the line
  push: { color: GIT, frames: ['»    ', ' »»  ', '  »»»', '   »»', '    »'] }, // goes out the right edge
  force: { color: 'warning', frames: ['▶    ', '▶▶   ', '▶▶▶  ', '▶▶▶▶ ', '▶▶▶▶▶'] }, // shoves through
  destructive: { color: 'error', frames: ['█████', '█▓█▓█', '▓▒▓▒▓', '▒░▒░▒', '░ ░ ░'] }, // crumbles away
  'task-done': { color: 'success', frames: ['  ✦  ', ' ·✦· ', '· ✦ ·', ' ·✦· '] }, // a star bursts
  interrupted: { color: 'inactive', frames: ['━━━━━', '━━━╸ ', '━━╸  ', '━╸   ', '╸    '] }, // a line cut short
}

export const TICK_MS = 130 // one frame
export const CUE_MS = 6000 // how long a cue stays by default: `cue_duration`'s default, and the audition page's

// What triggered it, one line and short: a command, a file, a tool.
export const cut = (text: string, max = 48) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
export const base = (path: string) => path.split(/[\\/]/).pop() ?? path
