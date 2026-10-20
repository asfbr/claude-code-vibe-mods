# Contributing

Issues and pull requests are welcome. If you're about to fork to change how a mod behaves, consider a pull
request here first: what helps you probably helps the next person, and it saves you keeping a fork in sync.

## Test

From a mod's folder:

```sh
claude plugin validate .
claude plugin test .
```

`statusline` has no tests: pipe a payload into it (`echo '{...}' | node statusline.js`), or set
`STATUSLINE_DEBUG=1` to see why a row came out blank.

## Rules

- **Only ship sounds anyone may redistribute** (CC0, public domain, or CC-BY with a credit). A new clip
  goes in `announcer/scripts/packs.json` with its link, licence and credit, and `scripts/packs.py`
  rebuilds the pack and its `CREDITS.md`. Copyrighted clips go in the `personal` pack: the repo stores the
  link, never the file.
- **No new runtime dependencies.** The mods use only Claude Code's mod API; the scripts use only Python's
  standard library, except `packs.py` and `drone.py`, which only maintainers run.
- **Nothing reaches the model.** A mod that adds to the prompt or the conversation needs its own issue first.
- Match the style around you: short comments, and each README says what its mod does and how to set it up.

## Pull requests

Small and about one thing, with the mod's tests passing and a line in `CHANGELOG.md` under
`## Unreleased` (add the heading if it isn't there). Leave the versions alone: the mods share one, bumped
together at release. A change you can see or hear
says how to try it. By contributing you agree your work is released under the MIT license.
