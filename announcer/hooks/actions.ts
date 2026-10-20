// What Claude did, as the actions the packs sound (sounds/<pack>/<action>.wav, listed in scripts/packs.json).
export const ACTIONS = [
  'question', 'permission', 'subagent', 'edit', 'big-refactor', 'tests-fail', 'green-after-red', 'tool-error',
  'commit', 'push', 'force', 'destructive', 'install', 'compacted', 'background-done',
  'task-done', 'interrupted',
] as const
export type Action = (typeof ACTIONS)[number]

// When each fires, as `/announcer list` tells it; the README's table says the same.
export const WHEN: Record<Action, string> = {
  question: 'Claude asks you (AskUserQuestion, a plan to approve)',
  permission: 'a permission dialog opens',
  subagent: 'Claude spawns a subagent (with the subagents setting on)',
  edit: "the turn's first file edit",
  'big-refactor': 'the tenth file edited in one turn',
  'tests-fail': 'a test/build/lint run fails, by its exit code or its summary (once a turn)',
  'green-after-red': 'a test/build/lint run passes after one failed',
  'tool-error': 'an edit or an MCP call errors (once a turn)',
  commit: 'git commit succeeds (git prints the new commit)',
  push: 'git push starts',
  force: 'a command with --force or --no-verify starts',
  destructive: 'rm -rf, git reset --hard, git clean -f, a force push or DROP TABLE starts',
  install: 'a package install starts (npm, pip, uv, cargo, winget …)',
  compacted: 'the conversation is compacted',
  'background-done': "a background task's notification arrives (a subagent's only with the subagents setting on)",
  'task-done': "a win, when the win call's own sound is off",
  interrupted: 'you interrupt a turn',
}

// A test/build/lint/typecheck run: a runner then a check word, or a checker by name.
const CHECK = /\b(npm|pnpm|yarn|bun|npx|node|deno|python3?|py|uv|poetry|cargo|go|dotnet|make|gradle|mvn|claude plugin)\b.*\b(test|tests|lint|typecheck|build|check|vet|clippy)\b|\b(pytest|vitest|jest|mocha|tsc|eslint|ruff|mypy|pyright)\b/
// Quoted text is what a command says, not what it runs: `git commit -m "fix npm test"` runs no tests.
const QUOTED = /(["'])(?:\\[\s\S]|(?!\1)[\s\S])*\1/g
const unquoted = (command: string) => command.replace(QUOTED, '""')
export const isCheck = (command: string) => CHECK.test(unquoted(command))
// A piped check (`npm test 2>&1 | tail`) exits with the pipe's last command, 0, so its own summary tells a failure:
// vitest/jest/pytest/mocha counts, jest/go/pytest FAIL lines, tsc, ruff/mypy, eslint errors (not warnings), cargo, vite.
const FAILED = /\b[1-9]\d* (failed|failing)\b|^\s*FAIL(ED)?\b|\berror TS\d+|\bFound [1-9]\d* errors?\b|✖ \d+ problems? \([1-9]|\btest result: FAILED\b|\berror during build\b/m
export const failedOutput = (output: string) => FAILED.test(output)

const DESTRUCTIVE = /\brm\s+-[a-z]*(r[a-z]*f|f[a-z]*r)|\bRemove-Item\b.*-Recurse|\bgit\s+reset\s+--hard|\bgit\s+clean\s+-[a-z]*f|\bgit\s+push\b.*\s(--force(-with-lease)?|-f)\b|\bdrop\s+(table|database|schema)\b/i
const FORCE = /\s(--no-verify|--force)\b/
const PUSH = /\bgit\s+push\b/
const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b|\bpip3?\s+install\b|\buv\s+(add|pip\s+install)\b|\bpoetry\s+add\b|\bcargo\s+(add|install)\b|\b(winget|choco|scoop|brew|apt(-get)?)\s+install\b|\bgo\s+(get|install)\b|\bgem\s+install\b/
const COMMIT = /\bgit\s+commit\b/

// The sound as a command starts, at most one: a force push is destructive, not a push.
export const beforeRun = (command: string): Action | undefined => {
  const runs = unquoted(command)
  return DESTRUCTIVE.test(runs) ? 'destructive' : FORCE.test(runs) ? 'force' : PUSH.test(runs) ? 'push'
    : INSTALL.test(runs) ? 'install' : undefined
}

// The sound once it has run, from its result. A piped commit (`git commit … | tail`) exits 0 even when a hook
// rejects it, so it counts only once git prints the new commit, `[main 1a2b3c4] …`, or nothing at all (`-q`).
const LANDED = /^\[[^\]\n]+ [0-9a-f]{4,}\] /m
export const afterRun = (command: string, isOk: boolean, output: string): Action | undefined =>
  isOk && COMMIT.test(unquoted(command)) && (LANDED.test(output) || output.trim() === '') ? 'commit' : undefined
