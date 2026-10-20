// A breath in the pane: its pattern, how many breaths, and when it started (ms since the epoch).
export type Run = { pattern: string; cycles: number; startedAt: number }
// What the pane shows under the picture, changed about once a second.
export type Words = { label: string; count: string; done: number }

declare module 'claude-code' {
  interface PluginState {
    breathe: { run: Run | null; words: Words }
  }
}
