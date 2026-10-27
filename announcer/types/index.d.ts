export type Streak = number
// The cue on screen: which action, what triggered it, its frame; `id` tells a newer cue from the one it replaced.
// `settled`: its time is up and `linger` keeps it, on its last frame.
export type ShownCue = { id: number; action: string; detail: string; frame: number; settled?: boolean }
// The last win's line, `HEADSHOT · streak 3`, kept under the prompt.
export type WinLine = string

declare module 'claude-code' {
  interface PluginState {
    announcer: { streak: Streak; cue: ShownCue | null; win: WinLine | null }
  }
}
