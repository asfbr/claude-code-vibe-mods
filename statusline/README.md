# Claude Code statusline

A single-file, dependency-free statusline for Claude Code. Renders context fill, prompt-cache
warmth, session cost and the subscription rate-limit windows on one right-aligned row.

```
Opus · my-app · ⑂ main   ▓▓▓░░░░░░░ 28% 284k/1M · ● 42m/1h · $0.42 +156/-23 · 5h 24% ↻ 1h42 · 7d 41%
```

The script is a **subprocess of the CLI, not the model** — Claude Code writes session JSON to its
stdin and prints whatever comes back. It costs zero tokens and never enters a conversation.

## Install

Add to `~/.claude/settings.json`, with your clone's path under your home folder:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node -e \"require(require('os').homedir()+'/claude-code-vibe-mods/statusline/statusline.js')\""
  },
  "subagentStatusLine": {
    "type": "command",
    "command": "node -e \"require(require('os').homedir()+'/claude-code-vibe-mods/statusline/subagent-statusline.js')\""
  }
}
```

`subagentStatusLine` is optional: each subagent's row becomes name · model · status · tokens (Claude
Code's own row leaves the model out).

Needs Node 18+. It takes effect on the next redraw; no restart.

**Why that command and not a plain path.** Claude Code runs the statusline through Git Bash where
it exists and PowerShell otherwise. The docs say `~` expands on Windows — it does under Git Bash,
but PowerShell passes `~` to Node literally and the script is never found. Letting Node resolve
`homedir()` is the only form that works under every shell.

## Reading the row

| Element | Meaning |
|---|---|
| `▓` / `░` | Context used / free |
| `28% 284k/1M` | Context fill; the token count is input-only, matching how Claude Code computes the percentage |
| `● 42m/1h` | Prompt cache is warm: time left before it expires / the TTL the last request wrote |
| `○ cold` | Cache expired — the next turn re-sends the whole prefix |
| `$0.42 +156/-23` | Session spend, lines added/removed |
| `5h 24% ↻ 1h42` | 5-hour rate-limit window, and time until it resets |
| `7d 41%` | 7-day window (no countdown — it lands on the same weekday every time) |
| `F 41%` | Fable's weekly window, when the payload carries it — see below |

Green below 60%, yellow at 60, red at 85, applied per figure. The cold dot is yellow whatever the
context fill is: cold is the state that costs you something.

**Colour is explicit truecolor (`38;2;r;g;b`), never the SGR "dim" attribute.** `\x1b[2m` renders at
roughly 40% opacity in Windows Terminal, and dim stacked on a colour — which an earlier version of
this script used for the cached half of a two-tone bar — is essentially invisible. Greys here are
real greys.

### The cache countdown

`prompt_cache` carries `warm`, `caching_observed`, `ttl` and `expires_at`; the countdown is derived
from the server's own `expires_at`, not from assuming the TTL. It only advances when the row
redraws, which by default happens on state changes rather than on a clock — add
`"refreshInterval": 60` to the `statusLine` settings block for a timer that ticks while you idle.

The `/5m` or `/1h` suffix is `ttl`, read from the response's own cache-write breakdown. It matters
beyond the countdown: idle compaction (v2.1.299+) only arms on a 1h TTL with 200K+ context, firing at
~54 min. `/5m` means it is off. Since ~v2.1.296 interactive subscriber sessions were seen writing 5m
while headless `claude -p` still wrote 1h, cause unknown; `"promptCacheTtl": "1h"` in settings is the client-side override (untested here).

### Fable

Fable's weekly window is `seven_day_overage_included` server-side (the CLI bundle literally labels
it "Fable limit"), and can also arrive as a `model_scoped` row whose `utilization` is a **0-1
fraction, not a percentage**. Claude Code 2.1.273 passes neither to the statusline — only
`five_hour`, `seven_day` and `spend_limit` arrive — so the `F` segment reads both shapes, renders
nothing today, and lights up on its own if a later version starts sending one.

## Layout

One row when it fits. When it doesn't, identity moves to its own row above a right-aligned usage
row — wrapping is always preferred to dropping information. Only below roughly 70 columns does it
start shedding segments, in order: lines changed → token count → the cache dot → the bar. The
rate-limit figures are never dropped.

Width comes from the `COLUMNS` env var, which Claude Code sets before each run; the docs are
explicit that `tput cols` and language-level width detection cannot work here, because stdout is
captured rather than attached to the terminal.

The repo README's picture of the row is drawn by `node scripts/svg.js` from a made-up session;
rerun it after changing the row.

## Knobs

| Env var | Effect |
|---|---|
| `STATUSLINE_RESERVE` | Characters held back from `COLUMNS` (default 8). The row can't use the full width: the UI indents it and renders notifications at the right end. Raise it if the row gets an ellipsis, lower it if the right edge floats. |
| `STATUSLINE_DEBUG` | Print the exception instead of swallowing it. A statusline that throws otherwise renders as a silent blank row. |

## Absent fields

Everything is guarded, because most of the payload is conditional:

- `rate_limits` — only for Pro/Max subscribers, only after the first API response, and each window
  disappears once its `resets_at` passes. A missing window is dropped, never printed as `0%`.
- `context_window.current_usage` — null before the first API call and again after `/compact`.
- `cost` — absent early; the segment disappears rather than printing `$0.00`.

## Traps worth knowing

- **PowerShell prepends a UTF-8 BOM** when piping to a native command, and `JSON.parse` rejects a
  leading `﻿`. Symptom: a permanently blank statusline, no error anywhere. The script strips it.
- **`used_percentage` is input-only** (`input + cache_creation + cache_read`, excluding output). Any
  token figure you print alongside it must use the same formula or the number and the bar disagree.
- **Don't hardcode 200000** for the context size — read `context_window_size`, which is 1000000 on
  extended-context models.
- **Reading the branch via a `git` subprocess** is wasteful here: the row redraws on a 300ms debounce.
  Read `.git/HEAD` directly (and handle the worktree case, where `.git` is a file, not a directory).
- **The payload has no context breakdown.** Claude Code hands over totals only; the system prompt,
  tool schemas and skills are nowhere on disk, and the transcript stops matching the real context
  after a `/compact`. `/context`'s system/memory/skills split cannot be reproduced here — don't
  estimate it and present it as a measurement. A mod can get it (`$.session.usage({ breakdown })`), as
  [context-bar](https://github.com/hamzafer/claude-code-mods/tree/main/mods/context-bar) does; this stays
  a plain status-line script on purpose, so it works with no mods loaded. Use both if you want the split.

## Not included

Todo/task tracking, which the `claude-hud` plugin has. Neither the statusline payload nor the
subagent payload exposes todos; getting them means reading Claude Code's internal transcript files,
which is undocumented and breaks on version bumps.

Effort and context fill per subagent: `subagentStatusLine`'s payload carries both, the row leaves them out.
