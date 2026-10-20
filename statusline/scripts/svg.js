#!/usr/bin/env node
// Draws the README's picture of the row: a made-up session piped through statusline.js, its
// truecolor output turned into an SVG. Rerun after changing the row: node scripts/svg.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const now = Math.floor(Date.now() / 1000);
const session = {
  model: { display_name: 'Opus' },
  workspace: { current_dir: '/home/you/my-app', git_worktree: 'main' },
  context_window: {
    used_percentage: 28,
    context_window_size: 1000000,
    current_usage: { input_tokens: 4000, cache_creation_input_tokens: 12000, cache_read_input_tokens: 268000 },
  },
  prompt_cache: { warm: true, caching_observed: true, ttl: '1h', expires_at: now + 42 * 60 + 30 },
  cost: { total_cost_usd: 0.42, total_lines_added: 156, total_lines_removed: 23 },
  rate_limits: {
    five_hour: { used_percentage: 24, resets_at: now + 102 * 60 + 30 },
    seven_day: { used_percentage: 41 },
  },
};

const row = (cols) => spawnSync(process.execPath, [path.join(__dirname, '..', 'statusline.js')], {
  input: JSON.stringify(session),
  env: { ...process.env, COLUMNS: String(cols), STATUSLINE_RESERVE: '0' },
  encoding: 'utf8',
}).stdout.replace(/\n$/, '');
// The narrowest width that keeps one row, plus a short right-aligned gap.
let cols = 80;
while (row(cols).includes('\n') && cols < 200) cols++;
const out = row(cols + 3);
if (!out || out.includes('\n')) throw new Error(`expected one row, got: ${JSON.stringify(out)}`);

// Words with their colour and weight, at their terminal column (one per codepoint, as statusline.js counts).
const FG = '#d4d4d4';
const runs = [];
let style = { color: FG, bold: false };
let col = 0;
for (const part of out.split(/(\x1b\[[0-9;]*m)/)) {
  const sgr = part.match(/^\x1b\[([0-9;]*)m$/);
  if (sgr) {
    const p = sgr[1].split(';').map(Number);
    if (p[0] === 0) style = { color: FG, bold: false };
    else if (p[0] === 1) style = { ...style, bold: true };
    else if (p[0] === 38 && p[1] === 2) style = { ...style, color: `rgb(${p[2]},${p[3]},${p[4]})` };
    continue;
  }
  for (const word of part.split(/( +)/)) {
    const len = [...word].length;
    if (word.trim()) runs.push({ col, text: word, len, ...style });
    col += len;
  }
}

// A 14px monospace cell. Each word sits at its own column, stretched to its width, so neither a
// glyph from a fallback font nor the browser's handling of spaces can shift what follows.
const CW = 8.4;
const PAD = 14;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const texts = runs.map((r) =>
  `  <text x="${(PAD + r.col * CW).toFixed(1)}" y="27" fill="${r.color}"${r.bold ? ' font-weight="bold"' : ''}` +
  ` textLength="${(r.len * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(r.text)}</text>`);
const width = Math.ceil(PAD * 2 + col * CW);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="42" viewBox="0 0 ${width} 42" xml:space="preserve"
  font-family="ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace" font-size="14">
  <rect width="100%" height="100%" rx="6" fill="#1e1e1e"/>
${texts.join('\n')}
</svg>
`;
const file = path.join(__dirname, '..', '..', 'docs', 'screenshots', 'statusline.svg');
fs.writeFileSync(file, svg);
console.log(`${path.relative(process.cwd(), file)}: ${col} columns`);
