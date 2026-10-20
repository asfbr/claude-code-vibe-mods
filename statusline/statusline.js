#!/usr/bin/env node
// Claude Code statusline: model / dir / branch, then context, prompt cache, cost and windows.
// One row when it fits, two when it doesn't — see layout() for the wrap-before-drop order.
// Every field here can be absent (rate_limits only after the first API response), so
// nothing is accessed without a guard and a missing window is dropped, never shown as 0.

const fs = require('fs');
const path = require('path');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Explicit truecolor everywhere: the SGR "dim" attribute (\x1b[2m) is what made the old bar
// unreadable — Windows Terminal renders it at roughly 40% opacity, and dim-over-color is
// close to invisible. MUTED is the quiet tone; it is a real grey, not an attribute.
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const MUTED = rgb(138, 138, 138);
const TRACK = rgb(82, 82, 82);
const GREEN = rgb(112, 200, 128);
const YELLOW = rgb(224, 184, 72);
const RED = rgb(232, 104, 94);

const SEP = `${MUTED} · ${RESET}`;

const tone = (p) => (p >= 85 ? RED : p >= 60 ? YELLOW : GREEN);

function bar(pct, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return `${tone(pct)}${'▓'.repeat(filled)}${RESET}${TRACK}${'░'.repeat(width - filled)}${RESET}`;
}

// Prompt cache: ● + time left while the entries are still warm, ○ once they have expired.
// A cold cache means the next turn re-sends the whole prefix, so the countdown is the useful
// number — `ttl` is the server's own value, not an assumption. Shown as "4m/5m" so a session
// written at 5m (no idle compaction: that only arms on a 1h TTL) is visible at a glance.
function cache(pc) {
  if (!pc || pc.caching_observed === false) return null;
  const left = pc.expires_at ? pc.expires_at - Math.floor(Date.now() / 1000) : 0;
  if (!pc.warm || left <= 0) return `${YELLOW}○${RESET}${MUTED} cold${RESET}`;
  return `${GREEN}●${RESET}${MUTED} ${until(pc.expires_at)}${pc.ttl ? `/${pc.ttl}` : ''}${RESET}`;
}

function tokens(n) {
  if (!n) return '';
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(2))}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

// "1h42" / "3d4h" / "18m" — how long until a window resets.
function until(epoch) {
  if (!epoch) return '';
  const s = epoch - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}m`;
}

// Read .git/HEAD directly: a `git` subprocess on every 300ms redraw is not worth a branch name.
function branch(startDir) {
  let cur = startDir;
  for (let i = 0; i < 10 && cur; i++) {
    try {
      const dotGit = path.join(cur, '.git');
      let gitDir = dotGit;
      if (fs.statSync(dotGit).isFile()) {
        const link = fs.readFileSync(dotGit, 'utf8').trim();
        gitDir = path.resolve(cur, link.replace(/^gitdir:\s*/, ''));
      }
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      return head.startsWith('ref: ') ? head.slice(head.lastIndexOf('/') + 1) : head.slice(0, 7);
    } catch {
      /* keep walking up */
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return '';
}

// showReset is off for the 7-day window: it lands on the same weekday every time.
function window(label, w, showReset = true) {
  if (!w || typeof w.used_percentage !== 'number') return null;
  const pct = Math.round(w.used_percentage);
  const reset = showReset ? until(w.resets_at) : '';
  return `${MUTED}${label}${RESET} ${tone(pct)}${pct}%${RESET}${reset ? `${MUTED} ↻ ${reset}${RESET}` : ''}`;
}

// Fable's own weekly window, shown without a reset time. Claude Code 2.1.273 does not hand
// this to the statusline (only five_hour / seven_day / spend_limit arrive), so this renders
// nothing today and lights up on its own if a later version starts sending either shape:
// `seven_day_overage_included` — the server's name for it — or a `model_scoped` row, whose
// `utilization` is a 0-1 fraction rather than a percentage.
function fable(rl) {
  if (!rl) return null;
  if (typeof rl.seven_day_overage_included?.used_percentage === 'number') {
    return window('F', rl.seven_day_overage_included, false);
  }
  const row = (rl.model_scoped || []).find((r) => /fable/i.test(r?.display_name || ''));
  if (typeof row?.utilization !== 'number') return null;
  return window('F', { used_percentage: row.utilization * 100 }, false);
}

// Count codepoints, not UTF-16 units. The non-ASCII glyphs here (· ⑂ ↻ ▓ ░ ● ○) are all
// East-Asian-AMBIGUOUS, which mainstream terminals render one column wide.
const visibleLen = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length;

// Claude Code captures stdout, so terminal size only comes from the env vars it sets.
// The row also carries built-in side spacing and renders notifications at its right edge,
// so the budget is deliberately well short of COLUMNS. Tuned on Windows Terminal: raise it
// if the row gets an ellipsis, lower it if the right edge floats. Override without editing.
const RESERVE = Number.parseInt(process.env.STATUSLINE_RESERVE || '', 10) || 8;

function budget() {
  const cols = Number.parseInt(process.env.COLUMNS || '', 10);
  return (Number.isFinite(cols) ? cols : 80) - RESERVE;
}

function justify(left, right) {
  const gap = budget() - visibleLen(left) - visibleLen(right);
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  return visibleLen(left) ? `${left}${SEP}${right}` : right;
}

function render(d) {
  const ws = d.workspace || {};
  const dir = ws.current_dir ? path.basename(ws.current_dir) : '';
  const br = ws.git_worktree || branch(ws.current_dir || process.cwd());

  const cw = d.context_window || {};
  const pct = Math.round(cw.used_percentage ?? 0);
  const u = cw.current_usage;
  // used_percentage counts input only (input + cache creation + cache read); match it.
  const used = u
    ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    : 0;
  const size = cw.context_window_size || 200000;

  const identity = [
    `${BOLD}${d.model?.display_name || 'claude'}${RESET}`,
    dir,
    br && `${MUTED}⑂${RESET} ${br}`,
  ].filter(Boolean).join(SEP);

  const cost = d.cost || {};
  const money = typeof cost.total_cost_usd === 'number' ? `$${cost.total_cost_usd.toFixed(2)}` : '';
  const lines = cost.total_lines_added || cost.total_lines_removed
    ? `${GREEN}+${cost.total_lines_added || 0}${RESET}${MUTED}/${RESET}${RED}-${cost.total_lines_removed || 0}${RESET}`
    : '';

  const segments = (opts) => [
    `${opts.bar ? `${bar(pct)} ` : ''}${tone(pct)}${pct}%${RESET}` +
      (opts.count && used ? `${MUTED} ${tokens(used)}/${tokens(size)}${RESET}` : ''),
    opts.cache && cache(d.prompt_cache),
    [money && `${MUTED}${money}${RESET}`, opts.lines && lines].filter(Boolean).join(' '),
    window('5h', d.rate_limits?.five_hour),
    window('7d', d.rate_limits?.seven_day, false),
    window('$', d.rate_limits?.spend_limit, false),
    fable(d.rate_limits),
  ].filter(Boolean).join(SEP);

  return layout(identity, segments);
}

// Prefer wrapping over losing information: one row, else identity above a right-aligned
// usage row. Only a terminal too narrow for the usage row alone starts dropping segments.
function layout(identity, segments) {
  const full = segments({ bar: true, count: true, lines: true, cache: true });
  const oneRow = justify(identity, full);
  if (visibleLen(oneRow) <= budget()) return oneRow;

  if (visibleLen(full) <= budget()) return `${identity}\n${justify('', full)}`;

  const fallbacks = [
    { bar: true, count: true, lines: false, cache: true },
    { bar: true, count: false, lines: false, cache: true },
    { bar: true, count: false, lines: false, cache: false },
    { bar: false, count: false, lines: false, cache: false },
  ];
  let row = full;
  for (const opts of fallbacks) {
    row = segments(opts);
    if (visibleLen(row) <= budget()) break;
  }
  return `${identity}\n${justify('', row)}`;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let out = '';
  try {
    // PowerShell prepends a UTF-8 BOM when piping to a native command, and JSON.parse
    // rejects it. Claude Code uses PowerShell wherever Git Bash isn't installed.
    out = render(JSON.parse(raw.replace(/^\uFEFF/, '')));
  } catch (e) {
    // A statusline that throws must not spam the row; STATUSLINE_DEBUG surfaces it instead.
    out = process.env.STATUSLINE_DEBUG ? `statusline: ${e.message}` : '';
  }
  process.stdout.write(`${out}\n`);
});
