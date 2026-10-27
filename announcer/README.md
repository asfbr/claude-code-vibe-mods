# announcer

Claude Code mod: a game announcer's call and its sound when Claude finishes a task. A line in
global CLAUDE.md (the voice's calls, each with when it fits) has Claude open its wrap-up with the fitting
one, e.g. `**H E A D S H O T**`, and the mod plays it. A turn that edited files and whose last
test/build/lint passed counts too. Along the way, a short sound marks what Claude does (action sounds, below).

The calls live in CLAUDE.md, not a mod `prompt.compose` section: since Claude Code 2.1.304 the managed
`cc-plugin-sec-default` skips user-tier hooks there ("its prompt.compose hook was skipped"). Changing
`theme` means rewriting that line from the voice's `calls` in `themes/index.ts`. The same goes for
`session.compact`, so `compacted` hangs on the classic `PostCompact` event instead.

## Setup (once per machine)

In Claude Code 2.1.275 or later:

```
/plugin marketplace add asfbr/claude-code-vibe-mods
/plugin install announcer@claude-code-vibe-mods
```

Or from a clone, in `~/.claude/settings.json` (a clone is the better home for the game voices, below):

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-code-vibe-mods/announcer" }
```

Add the calls to `~/.claude/CLAUDE.md` (this is the UT99 voice's line):

```markdown
- Announcer (mod `announcer`, UT99 voice): **every time a requested task is finished and its checks pass, open the wrap-up with one call in bold spaced caps** (`**H E A D S H O T**`), picked by the work: HEADSHOT (one precise fix), DOUBLE / TRIPLE KILL (two / three things done), MULTI KILL (several parts landed), MEGA / ULTRA / MONSTER KILL (big → huge job, all green), NICE CATCH (caught a bug before it shipped), TAKEN THE LEAD (green after red), ASSIST (helped the user's own fix), WINNER (shipped or deployed). Caveats or open follow-ups are no reason to skip it: say the call, then list them. Skip only when the task failed or is unfinished, and in subagents.
```

Build the game voices once (Python 3, stdlib only; ~50 MB of downloads, kept in the cache dir):

```sh
python scripts/sounds.py ~/.cache/announcer
```

Until then a win sounds the free pack's `task-done` clip. The voices are built into the mod's own folder, so
on a marketplace install run the script from the installed copy (under `~/.claude/plugins/cache/claude-code-vibe-mods/announcer/`),
and again after each update, which installs a fresh copy (the downloads stay cached, so a rerun is quick). Restart Claude Code. `claude plugin list` should
show `announcer@...` loaded.

## Options (`/config`)

- `detect`: `both` (default), `marker` (Claude's call only), `tools` (edits + green check; Claude's call
  is ignored, so drop the CLAUDE.md line too), `off` (no win calls at all: action sounds only, no CLAUDE.md
  line). The line costs ~150 tokens (cached) and ~10 per call. For win calls only, set `actions` to `off`.
- `theme`: `ut99` (default), `ut2003`, `ut2004-female`, `xan` (the UT99 boss), `quake3`.
- `sound`: the win call's sound; off = the call is text only, and the action pack's `task-done` marks the win.
  `volume`: 100% … 10% (default 35%), for calls and actions alike.
- `actions`: `free` (default), `personal` (your own clips, the free one where you have none), `off`.
- `spacing`: `any time` (default), `2 min`, `5 min`, `15 min`: an action that sounded this recently stays
  silent, its cue still showing (fewer edit, test and error sounds on a busy run). `question`, `permission`,
  `force`, `destructive` and the win always sound.
- One setting per action (`push`, `big_refactor` …: setting keys take `_` for `-`): `default` follows
  `actions`; `free`, `personal` or `off` overrides it for that action alone. An action set `off` gets no cue either.
  These 17 rows show in `/config` only with `each_action` ("one row each") on; hidden, what they are set to still
  applies, and `/announcer list` shows it.
- `cues` (default on): each action's visual cue, below. Off = sounds only. `cue_duration`: `3 sec`, `6 sec`
  (default), `10 sec`, `20 sec`, `30 sec`, how long it stays: longer leaves time to find which of several
  terminals just sounded. `linger` (default off): when its time is up a cue stays on its last frame, with the
  last win call and streak beside it, until the next cue replaces it; off, it goes.
- `calls` (default on): no sound, win calls included, while any app is using the microphone (a call, a meeting
  recorder, dictation), read from Windows' own microphone-use list; cues still show. Windows only.
- `subagents` (default off): off, spawning a subagent and its end notification (`Agent "…" finished`) make no
  sound and no cue; a background command's or a monitor's notification still does. A subagent's permission
  dialog always sounds: it waits on you.

One win, one clip: Claude's own call, or, when Claude made none (a tools win, or a call the voice lacks), the
streak's rung (FIRST BLOOD, KILLING SPREE … one up per win, the last repeating). A win while another win's
clip plays stays silent; one while an action's clip plays waits for it. The hint row under the prompt (below a
custom status line) keeps `CALL · streak n`; a win with no call in Claude's reply also gets a one-line toast. The streak counts wins per
session; a failed check resets it.

## Action sounds

What Claude does, not what it writes. One clip at a time: an action landing while one plays is dropped. A
subagent's own calls make no sound. `/announcer list` shows each action's clip; `/announcer play <action>`
plays it (to audition a pack) and waits for it, so a clip that cannot play says why in the reply.

Each action also gets a cue for `cue_duration`: a five-cell animation, its name and what triggered it (the
command, the file, the tool), e.g. `──●── commit  git commit -m "fix the login…"`. It draws as one line in the
band directly above the prompt (the `AbovePrompt` site; the hint row under the prompt is not drawn while a
custom status line is set). A survey keeps the band; a new cue replaces the one on screen, even when its clip
was dropped. The motions and colours are in `hooks/cues.ts`.

| Action | When |
|---|---|
| `question` | Claude asks you (`AskUserQuestion`, a plan to approve) |
| `permission` | a permission dialog opens |
| `subagent` | Claude spawns a subagent (with `subagents` on) |
| `edit` / `big-refactor` | the first file edited in a turn / the tenth (once per turn each) |
| `tests-fail` / `green-after-red` | a test/build/lint run fails / passes after one failed (once per turn); a piped run (`npm test \| tail`) exits 0, so its summary (`1 failed`, `error TS…`) counts too |
| `tool-error` | an edit or an MCP call errors (once per turn) |
| `commit` | `git commit` succeeds: git prints the new commit (a piped commit a hook rejected still exits 0) |
| `push` / `force` / `destructive` | as `git push`, `--force`/`--no-verify`, or `rm -rf`, `reset --hard`, a force push, `DROP TABLE` start |
| `install` | a package install starts (npm, pip, uv, cargo, winget …) |
| `compacted` | the conversation is compacted |
| `background-done` | a background task's notification arrives (a subagent's only with `subagents` on) |
| `interrupted` | you interrupt a turn |
| `task-done` | a win, when the win call's sound is off |

Quoted text in a command is ignored when matching it: `git commit -m "fix npm test"` is a commit, not a test
run. The free pack's `root-cause` clip has no action yet: nothing Claude does signals it. `permission` rides Claude Code's own
PermissionRequest hook; a managed policy that skips user hooks there silences it.

## Sounds

`python scripts/sounds.py <cache dir>` fetches each source and rebuilds `sounds/<theme>/` small (11025 Hz
8-bit mono, peak-normalised, silence trimmed; ~1.5 MB for all five). A new voice = an entry in its
`SOURCES`, in `themes/index.ts` and in `plugin.json`'s theme options.

- UT99 and Xan: `Sounds/Announcer.uax`, `Sounds/BossVoice.uax` on the UT GOTY ISO (`archive.org/details/ut-goty`).
- UT2003 male, UT2004 female: `CD2/Sounds/AnnouncerMain.uax.uz2`, `announcerfemale2k4.uax.uz2` on the UT2004
  DVD (`archive.org/details/ut-2004-dvd`), which Epic lets OldUnreal host.
- Quake III: `sound/feedback/` in the demo's `pak0.pk3` (`linuxq3ademo-1.11-6.x86.gz.sh` on id's mirror at
  `ftp.gwdg.de/pub/misc/ftp.idsoftware.com/idstuff/quake3/linux/`, md5 `484610c1ce34272223a52ec331c99d5d`).

The game voices are Epic's and id Software's, so the repo ships the script, not the clips: `sounds/<theme>/`
is gitignored and each machine builds its own. On Windows the clips play through PowerShell's
`SoundPlayer.PlaySync`, the 8-bit samples scaled for volume (the engine's own player is silent there).

Action packs: `scripts/packs.json` lists one clip per action with its download link, licence, credit and an
optional cut `window` in seconds. `python scripts/packs.py <cache dir> [free|personal]` builds:

- `sounds/free/`: CC0, NASA and CC-BY clips, shippable, with `CREDITS.md` written from the same list (the
  CC-BY scream requires its credit).
- `sounds/personal/`: copyrighted clips, gitignored. The `personal` rows of `packs.json` are the download
  list: each machine (or anyone else) runs the script to fetch its own.

Every build also writes `sounds/index.html`: each action, its cue (looping, read from `hooks/cues.ts`), when it
fires and its clips, with a play button per clip that also plays the cue in a band at the bottom, to audition
the packs in a browser (`python scripts/packs.py board` rewrites just that page).

Same small format, plus loudness matching and ~150 ms of silence either side so a player waking up does not
eat the first word. It needs numpy, soundfile and soxr (`pip install numpy soundfile soxr` in a venv).

`claude plugin validate .` and `claude plugin test .` from this folder.
