# Changelog

The mods share one version, bumped together on each release.

## 0.3.4

- **announcer**: `linger` keeps an action's cue on the band above the prompt after its time is up, on its
  last frame, with the last win call and streak beside it (off by default: the cue goes, as before).

## 0.3.3

- **announcer**: the `compacted` sound hangs on the classic `PostCompact` event: the managed
  `cc-plugin-sec-default` skips user-tier `session.compact` hooks, so it never played.

## 0.3.2

- **announcer**: `cue_duration` sets how long an action's cue stays above the prompt (3 to 30 s), and the
  default goes from 2.6 to 6 s: time to find which of several terminals just sounded.

## 0.3.1

- **announcer**: `detect: off` turns the win calls off and keeps the action sounds (`actions: off` is the
  other way round). `spacing` holds an action's sound back until a few minutes after it last played (cues
  still show; questions, permissions, force and destructive commands always sound). The 17 per-action rows
  hide in `/config` behind one toggle, "one row each", and the rows are grouped as win call, then action sounds.
- **breathe**: swearing aimed at Claude, at what broke, or as a bare outburst now counts as heat; casual and
  glad swearing still doesn't. `sensitivity` (low / normal / high) sets how much heat opens a hot-prompt
  break; `/breathe heat` shows the score. A pane wider than the nebula widens it a little and fills the rest
  with stars.

## 0.3.0: first public release

- **announcer**: win calls in five voices (UT99, UT2003, UT2004 female, Xan, Quake III), action sounds
  and cues for what Claude does, the free CC0 / CC-BY pack.
- **breathe**: the breathing pane and Edge window, hot-prompt and scheduled breaks.
- **statusline**: context fill, cache countdown, cost and rate-limit windows; optional subagent row.
- Installs from this repo's marketplace (`/plugin marketplace add asfbr/claude-code-vibe-mods`, then `/plugin install <mod>@claude-code-vibe-mods`), or by pasting one prompt into Claude Code.
