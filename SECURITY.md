# Security

These mods run inside Claude Code on your machine and start processes (PowerShell, Edge, Python), so a
security bug here matters. If you find one, report it privately.

## Reporting

Use **Report a vulnerability** on this repo's *Security* tab (GitHub's private reporting). Please don't
open a public issue for it. Say what an attacker needs, what they get, and how to reproduce it.

Only the latest version is supported: fixes land on `main`.

## What counts

- **A command line built from untrusted text.** Prompts, tool calls and file paths reach the hooks; any of
  them getting into a PowerShell or Python command as code is a bug.
- **Anything reaching the model** that the README doesn't say does (it says: only the announcer's
  `CLAUDE.md` line, which you add yourself).
- **A script running what it downloaded.** `sounds.py` and `packs.py` fetch archives and cut audio from
  them; nothing they fetch may be executed.
- **The statusline** printing or sending anything beyond its row.

## What doesn't

- What the game archives themselves contain, and the sites that host them.
- Your own `insults.local.txt`, `personal` sound pack or settings.
