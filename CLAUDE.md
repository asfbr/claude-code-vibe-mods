A plugin marketplace (`.claude-plugin/marketplace.json`) of two Claude Code mods, `announcer` and `breathe`, plus
`statusline`, which is a plain status-line script, not a mod. The statusline predates mods. A mod could show
`/context`'s split with `$.session.usage({ breakdown })`, but we chose to keep it a script that works with no mods loaded. For the mod API (`claude-code` module, hooks, `$.ui`,
atoms, the test kit), load the `plugin-authoring` skill.

## Commands

- `claude plugin validate .` at the root (marketplace) or in a mod folder.
- `claude plugin test announcer` / `claude plugin test breathe`: runs every `*.test.ts(x)` in that mod. No per-test filter.
- statusline has no tests: `echo '{...}' | node statusline/statusline.js`, `STATUSLINE_DEBUG=1` to see a throw.
  `node statusline/scripts/svg.js` redraws the README picture after changing the row.
- CI (`.github/workflows/test.yml`) runs the same on `windows-latest`.

## How a mod is built

- `hooks/hooks.json` loads `hooks/register.tsx`, whose `register(on, options)` gets `plugin.json`'s `userConfig` as `options`.
- Shared state is `atom(...)`s, typed in `types/index.d.ts` under `PluginState`.
- Pure logic lives beside it and is tested directly: announcer `actions.ts` (command matching), `cues.ts`;
  breathe `anger.ts` (prompt heat), `sky.ts` (breath timeline, the pane's cells).
- Tests fake the engine by registering handlers for what the mod calls (`fs.exists`, `process.run`, `tool.call` …)
  in a `world()` helper at the top of each test file.

## Gotchas

- Windows: Claude Code's own audio player is silent, so clips play through `powershell.exe` `SoundPlayer` (WAVs
  must be 11025 Hz 8-bit mono). Windows is detected by `$.plugin.root` starting with a drive letter.
- The managed `cc-plugin-sec-default` skips user-tier `prompt.compose` and `session.compact` hooks: that is why the
  announcer's calls live in the user's CLAUDE.md and `compacted` hangs on `classic.PostCompact`.
- An action is listed in several places that must agree: `ACTIONS`/`WHEN` in `actions.ts`, `CUES` in `cues.ts`,
  its `userConfig` row in `plugin.json`, `scripts/packs.json`, and the announcer README table. A new voice: `themes/index.ts`,
  `plugin.json` theme options, `SOURCES` in `scripts/sounds.py`.
- Game voices (`sounds/<theme>/`) and `sounds/personal/` are gitignored, built locally. `scripts/packs.py` (needs
  numpy, soundfile, soxr) rebuilds `sounds/free/`, its `CREDITS.md` and `sounds/index.html`; `breathe/scripts/drone.py`
  (numpy) rebuilds the drones after a synth or timing change.

## Rules

`CONTRIBUTING.md` has them: redistributable sounds only, no runtime deps, nothing reaches the model, changes under
`## Unreleased` in `CHANGELOG.md`. Release commits read `0.3.4: announcer …`.
