"""Build sounds/<pack>/<id>.wav for the action packs listed in packs.json (free = shippable, personal = links only).

python scripts/packs.py <cache dir> [free|personal]   (downloads land in the cache dir, kept for the next run)
python scripts/packs.py board                          (only sounds/index.html, the page to hear each clip)
Needs numpy, soundfile (libsndfile reads MP3/OGG, no ffmpeg) and soxr: any venv that has them.
Same output as sounds.py (11025 Hz 8-bit mono, what the Windows player expects), but each clip is also cut to
its `window`, loudness-matched, faded where a cut lands mid-sound, and padded so players don't eat its edges.
"""
import html, io, json, os, re, sys, urllib.request, wave, zipfile
import numpy as np, soundfile as sf, soxr

RATE = 11025
HERE = os.path.dirname(os.path.abspath(__file__))
LEAD, TAIL = 0.15, 0.2  # silence padding: devices waking up swallow the first ~100 ms, some players the last
GAP = 0.35  # between the members of a multi-part clip ("Ready?" … "Go!")
CAP = 8.0  # longest clip without a window
TARGET_RMS, CEILING = 10 ** (-16 / 20), 10 ** (-1 / 20)

def fetch(url, cache):
    path = os.path.join(cache, url.rstrip('/').rsplit('/', 1)[1])
    if not os.path.exists(path):
        print('fetching', url)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
        open(path, 'wb').write(data)
    return open(path, 'rb').read()

def decode(data):
    x, sr = sf.read(io.BytesIO(data), always_2d=True)
    return soxr.resample(x.mean(1), sr, RATE)

def fade_in(x, seconds):
    n = min(len(x), int(seconds * RATE)); x[:n] *= np.linspace(0, 1, n)

def fade_out(x, seconds):
    n = min(len(x), int(seconds * RATE)); x[len(x) - n:] *= np.linspace(1, 0, n)

def trim(x):  # keep 30 ms before the first loud 10 ms and 150 ms after the last (decays fade below the threshold)
    hop = int(0.01 * RATE); env = np.array([np.abs(x[i:i + hop]).max() for i in range(0, len(x), hop)])
    loud = np.flatnonzero(env > 0.02 * env.max())
    return x[max(0, loud[0] * hop - int(0.03 * RATE)):min(len(x), (loud[-1] + 1) * hop + int(0.15 * RATE))]

def clip(entry, data):
    members = entry.get('member')
    if members is None: parts = [decode(data)]
    else:
        z = zipfile.ZipFile(io.BytesIO(data))
        parts = [decode(z.read(m)) for m in ([members] if isinstance(members, str) else members)]
    parts = [trim(p) for p in parts]
    x = np.concatenate([np.concatenate([p, np.zeros(int(GAP * RATE))]) for p in parts])[:-int(GAP * RATE)]
    a, b = (int(t * RATE) for t in entry.get('window', (0, CAP)))
    cut = b < len(x)  # a cut inside the sound gets a long fade out; a window start a softer fade in
    x = x[a:b].copy(); fade_in(x, 0.015 if a else 0.003); fade_out(x, 0.25 if cut else 0.01)
    active = x[np.abs(x) > 0.03 * np.abs(x).max()]  # loudness of the sound itself, not its silences
    x = x * min(TARGET_RMS / np.sqrt((active ** 2).mean()), CEILING / np.abs(x).max())
    x = np.concatenate([np.zeros(int(LEAD * RATE)), x, np.zeros(int(TAIL * RATE))])
    rng = np.random.default_rng(0)  # triangular dither: 8-bit without the gritty quantisation buzz
    pcm = np.clip(np.round(x * 127 + rng.random(len(x)) - rng.random(len(x))) + 128, 0, 255).astype(np.uint8)
    buf = io.BytesIO(); w = wave.open(buf, 'wb'); w.setnchannels(1); w.setsampwidth(1); w.setframerate(RATE)
    w.writeframes(pcm.tobytes()); w.close()
    return buf.getvalue(), len(x) / RATE

def board(entries):
    """sounds/index.html: each action, when it fires (hooks/actions.ts), its clips with a play button, and credits."""
    src = open(os.path.join(HERE, '..', 'hooks', 'actions.ts'), encoding='utf-8').read().split('export const WHEN')[1]
    when = re.findall(r"^\s+'?([\w-]+)'?: (['\"])(.*?)\2,$", src.split('\n}')[0], re.M)
    esc = lambda s: html.escape(str(s))
    def cell(action, pack):
        clips = [e for e in entries if e['pack'] == pack and re.fullmatch(re.escape(action) + r'(-2)?', e['id'])]
        if not clips: return f'<td class="none">{"none" if pack == "free" else "the free one plays"}</td>'
        rows = []
        for e in clips:
            link = f'<a href="{esc(e.get("page") or e["url"])}">source</a>'
            about = esc(e['sound']) + (f'<small>{esc(e["credit"])} · {esc(e["licence"])} · {link}</small>' if pack == 'free' else f' {link}')
            rows.append(f'<div class="clip"><button data-src="{pack}/{esc(e["id"])}.wav" aria-label="Play {esc(e["id"])} ({pack})">▶</button>'
                        f'<span>{about}</span></div>')
        return '<td>' + ''.join(rows) + '</td>'
    cues = open(os.path.join(HERE, '..', 'hooks', 'cues.ts'), encoding='utf-8').read()  # each action's cue, as the band shows it
    family = dict(re.findall(r"^const (\w+) = '(\w+)'$", cues, re.M))
    looks = {a: {'color': family.get(c, c.strip("'")), 'frames': re.findall(r"'([^']*)'", f)}
             for a, c, f in re.findall(r"^\s+'?([\w-]+)'?: \{ color: ('?\w+'?), frames: \[(.*?)\] \}", cues, re.M)}
    timing = dict(re.findall(r'^export const (TICK_MS|CUE_MS) = (\d+)', cues, re.M))
    body = '\n'.join(f'<tr><th>{esc(a)}</th><td class="cue" data-action="{esc(a)}"></td><td class="when">{esc(t)}</td>'
                     f'{cell(a, "free")}{cell(a, "personal")}</tr>' for a, _, t in when)
    page = (BOARD.replace('{rows}', body).replace('{cues}', json.dumps(looks, ensure_ascii=False))
            .replace('{tick}', timing['TICK_MS']).replace('{show}', timing['CUE_MS']))
    open(os.path.join(HERE, '..', 'sounds', 'index.html'), 'w', encoding='utf-8').write(page)
    print('board: sounds/index.html')

BOARD = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Announcer sounds</title>
<style>
:root { --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --line: #e7e5e4; --accent: #2563eb; --dim: #d6d3d1;
  --ide: #4782c8; --permission: #5769f7; --claude: #d77757; --merged: #8700ff; --success: #2c7a39; --error: #ab2b3f; --warning: #966c1e; --inactive: #666; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --line: #292524; --accent: #60a5fa; --dim: #44403c;
  --permission: #b1b9f9; --merged: #af87ff; --success: #4eba65; --error: #ff6b80; --warning: #ffc107; --inactive: #999; } }
body { background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; margin: 0; padding: 24px 16px 72px; }
.cue, .band { font-family: ui-monospace, Consolas, monospace; white-space: nowrap; }
.cue i, .band i { display: inline-block; width: 1.3ch; text-align: center; font-style: normal; } /* fallback glyphs keep five even cells */
.band { position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 16px; background: var(--bg); border-top: 1px solid var(--line); }
.band .idle { color: var(--dim); } .band .prompt { color: var(--muted); display: block; margin-top: 2px; }
h1 { font-size: 18px; margin: 0 0 4px; } p { color: var(--muted); margin: 0 0 16px; max-width: 70ch; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
thead th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
tbody th { font-family: ui-monospace, monospace; font-weight: 600; white-space: nowrap; } .when { color: var(--muted); max-width: 32ch; }
.clip { display: flex; gap: 8px; align-items: flex-start; } .clip + .clip { margin-top: 6px; }
.clip small { display: block; color: var(--muted); } .clip a { color: var(--muted); font-size: 12px; }
button { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--accent); cursor: pointer; }
button:hover { border-color: var(--accent); } button.playing { background: var(--accent); color: var(--bg); }
button:disabled { color: var(--dim); cursor: not-allowed; } .none { color: var(--dim); }
@media (max-width: 720px) { .when { display: none; } }
</style></head><body>
<h1>Announcer sounds</h1>
<p>Each action, its cue (from <code>hooks/cues.ts</code>), when it fires, and its clip in each pack. Built by <code>scripts/packs.py</code> from <code>scripts/packs.json</code>.
A grey button is a clip not built on this machine (the personal pack is gitignored: run the script to fetch it).
Playing a clip also shows its cue in the band at the bottom, as it shows above the prompt.</p>
<table><thead><tr><th>Action</th><th>Cue</th><th>When</th><th>Free</th><th>Personal</th></tr></thead><tbody>
{rows}
</tbody></table>
<div class="band" aria-live="polite"><span class="cue-line"><span class="idle">a cue shows here for a few seconds when a clip plays</span></span><span class="prompt">&gt;</span></div>
<script>
const CUES = {cues}, TICK = {tick}, SHOW = {show}
const still = matchMedia('(prefers-reduced-motion: reduce)').matches
const cells = frame => [...frame].map(c => `<i>${c === ' ' ? '' : c}</i>`).join('')
const at = (look, n) => look.frames[still ? Math.floor(look.frames.length / 2) : n % look.frames.length]

// The Cue column loops every action's motion; the band plays one from its first frame for SHOW ms, like the mod.
const rows = [...document.querySelectorAll('td.cue')].filter(td => CUES[td.dataset.action])
for (const td of rows) td.style.color = `var(--${CUES[td.dataset.action].color})`
let tick = 0
const draw = () => { for (const td of rows) td.innerHTML = cells(at(CUES[td.dataset.action], tick)) }
draw(); if (!still) setInterval(() => { tick += 1; draw() }, TICK)

const line = document.querySelector('.cue-line'), idle = line.innerHTML
let shown = null
const show = action => {
  const look = CUES[action]; if (!look) return
  clearInterval(shown)
  let frame = 0
  const paint = () => { line.innerHTML = `<span style="color: var(--${look.color})">${cells(at(look, frame))} ${action}</span>` }
  paint()
  shown = setInterval(() => { frame += 1; if (frame * TICK >= SHOW) { clearInterval(shown); line.innerHTML = idle } else paint() }, TICK)
}

let current = null
for (const b of document.querySelectorAll('button[data-src]')) {
  const probe = new Audio(); probe.preload = 'metadata'
  probe.onerror = () => { b.disabled = true; b.title = 'Not built on this machine' }
  probe.src = b.dataset.src
  b.onclick = () => {
    if (current) { current.audio.pause(); current.button.classList.remove('playing') }
    const audio = new Audio(b.dataset.src); current = { audio, button: b }
    b.classList.add('playing'); audio.onended = () => b.classList.remove('playing'); audio.play()
    show(b.closest('tr').querySelector('td.cue').dataset.action)
  }
}
</script>
</body></html>
'''

if __name__ == '__main__':
    entries = json.load(open(os.path.join(HERE, 'packs.json'), encoding='utf-8'))
    if sys.argv[1:] == ['board']: board(entries); sys.exit()
    if len(sys.argv) < 2 or not set(sys.argv[2:]) <= {'free', 'personal'}: sys.exit(__doc__.split('\n\n')[1])
    cache = sys.argv[1]; os.makedirs(cache, exist_ok=True)
    wanted = sys.argv[2:] or ['free', 'personal']
    for pack in wanted:
        out = os.path.join(HERE, '..', 'sounds', pack); os.makedirs(out, exist_ok=True)
        for f in os.listdir(out):
            if f.endswith('.wav'): os.remove(os.path.join(out, f))
        total = 0
        for e in (e for e in entries if e['pack'] == pack):
            try: wav, secs = clip(e, fetch(e['url'], cache))
            except Exception as err: print(f'  {e["id"]}: FAILED {err}'); continue
            open(os.path.join(out, e['id'] + '.wav'), 'wb').write(wav); total += len(wav)
            print(f'  {pack}/{e["id"]}: {secs:.1f} s, {len(wav) // 1024} KB')
        print(f'{pack}: {total // 1024} KB')
        if pack == 'free':  # shipped clips carry their credits; CC-BY ones require it
            lines = [f'- `{e["id"]}`: {e["sound"]}. {e["credit"]}. {e["licence"]}. {e["page"]}'
                     for e in entries if e['pack'] == 'free']
            open(os.path.join(out, 'CREDITS.md'), 'w', encoding='utf-8').write(
                '# Credits: the free pack\n\nBuilt by `scripts/packs.py` from `scripts/packs.json`.\n\n' + '\n'.join(lines) + '\n')
    board(entries)
