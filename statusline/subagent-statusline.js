#!/usr/bin/env node
// Per-subagent status line: always shows the model next to each running agent row.
// Default rendering (name · description · token count) never includes model — this does.

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const MUTED = rgb(138, 138, 138);
const GREEN = rgb(112, 200, 128);
const YELLOW = rgb(224, 184, 72);
const SEP = `${MUTED} · ${RESET}`;

// tasks[].model is a raw id (e.g. claude-haiku-4-5-20251001), unlike the main
// statusLine's model.display_name — so it needs the same prettification here.
const KNOWN = {
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-fable-5-1': 'Fable 5.1',
};

function displayName(id) {
  if (!id) return '';
  if (KNOWN[id]) return KNOWN[id];
  const s = id.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  const words = [];
  const nums = [];
  for (const part of s.split('-')) {
    if (/^\d+$/.test(part)) nums.push(part);
    else words.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  const name = words.join(' ');
  return nums.length ? `${name} ${nums.join('.')}` : name;
}

function statusColor(status) {
  if (status === 'running') return GREEN;
  if (status === 'error' || status === 'failed') return YELLOW;
  return MUTED;
}

function tokens(n) {
  if (!n) return '';
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(2))}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function renderTask(t) {
  const parts = [
    `${BOLD}${t.name || t.label || t.type || 'agent'}${RESET}`,
    displayName(t.model) && `${MUTED}${displayName(t.model)}${RESET}`,
    t.status && `${statusColor(t.status)}${t.status}${RESET}`,
    t.tokenCount && `${MUTED}${tokens(t.tokenCount)}tok${RESET}`,
  ].filter(Boolean);
  return parts.join(SEP);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const d = JSON.parse(raw.replace(/^﻿/, ''));
    const tasks = Array.isArray(d.tasks) ? d.tasks : [];
    const out = tasks.map((t) => JSON.stringify({ id: t.id, content: renderTask(t) })).join('\n');
    process.stdout.write(out ? `${out}\n` : '');
  } catch (e) {
    process.stdout.write(process.env.STATUSLINE_DEBUG ? `subagent-statusline: ${e.message}\n` : '');
  }
});
