"""Render sounds/drone-<pattern>.wav, the pane's drone: ui/breathe.html's WebAudio synth, offline.

python scripts/drone.py      (needs numpy; any Python that has it)
Each file holds three takes of one continuous render, which scripts/drone.ps1 stitches with short crossfades:
the intro plus OVERLAP, one steady breath plus OVERLAP (it loops), and the goodbye. 22050 Hz 16-bit mono.
Keep INTRO, OVERLAP, GOODBYE + FADE and the patterns in step with hooks/sky.ts and scripts/drone.ps1.
"""
import os, wave
import numpy as np

RATE = 22050
INTRO, OVERLAP, OUTRO = 1.6, 0.2, 3.2  # OUTRO: the goodbye (1.8 s) and its fade (1.4 s)
PATTERNS = {'4-6': [('in', 4), ('out', 6)], 'box': [('in', 4), ('hold', 4), ('out', 4), ('hold', 4)],
            '4-7-8': [('in', 4), ('hold', 7), ('out', 8)]}
CHORDS = {'in': [110, 164.81, 261.63], 'full': [87.31, 130.81, 220], 'out': [98, 146.83, 246.94], 'empty': [87.31, 130.81, 220]}
ORGAN = [0, 1, 0.5, 0.32, 0.2, 0.1, 0.12, 0, 0.06]  # cosine harmonics, as createPeriodicWave(real, imag=0)
HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(9301)
at_ = lambda seconds: round(seconds * RATE)  # every boundary lands on a whole sample at 22050 Hz

def follow(target, tau):
    """setTargetAtTime, per sample: an exponential approach to a stepwise target."""
    k, out, v = 1 - np.exp(-1 / (tau * RATE)), np.empty_like(target), target[0]
    for i, t in enumerate(target):
        v += (t - v) * k; out[i] = v
    return out

def biquad(x, freq, q, kind):
    """WebAudio's lowpass / bandpass (RBJ cookbook) with a cutoff that moves per sample."""
    w = 2 * np.pi * freq / RATE; alpha = np.sin(w) / (2 * q); cw = np.cos(w); a0 = 1 + alpha
    if kind == 'lowpass': b0 = b2 = (1 - cw) / 2 / a0; b1 = (1 - cw) / a0
    else: b0 = alpha / a0; b1 = np.zeros_like(w); b2 = -alpha / a0
    a1, a2 = -2 * cw / a0, (1 - alpha) / a0
    y, x1, x2, y1, y2 = np.empty_like(x), 0.0, 0.0, 0.0, 0.0
    for i in range(len(x)):
        v = b0[i] * x[i] + b1[i] * x1 + b2[i] * x2 - a1[i] * y1 - a2[i] * y2
        x2, x1, y2, y1 = x1, x[i], y1, v; y[i] = v
    return y

def organ(freq):
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    wave_ = sum(a * np.cos(k * phase) for k, a in enumerate(ORGAN) if a)
    return wave_ / sum(ORGAN)

def render(phases):
    cycle = sum(d for _, d in phases)
    n = at_(INTRO + 3 * cycle + OUTRO)
    t = np.arange(n) / RATE
    b, inhaling, moving = np.zeros(n), np.zeros(n, bool), np.zeros(n)
    chord = np.tile(np.array(CHORDS['empty'], float), (n, 1))
    at, prev = INTRO, phases[-1][0]
    for _ in range(3):
        for kind, dur in phases:
            s = slice(at_(at), at_(at + dur)); p = (t[s] - at) / dur; e = (1 - np.cos(np.pi * p)) / 2
            hue = ('full' if prev == 'in' else 'empty') if kind == 'hold' else kind
            b[s] = e if kind == 'in' else 1 - e if kind == 'out' else (1.0 if hue == 'full' else 0.0)
            if kind != 'hold': moving[s] = np.minimum(1, np.pi / 2 * np.sin(np.pi * p) / dur / 0.4)
            inhaling[s] = kind == 'in'
            chord[at_(at):] = CHORDS[hue]
            at, prev = at + dur, kind
    tone_in = organ(np.full(n, 55.0)) * 0.55  # the pedal: A1, all the way through
    for i, level in enumerate([0.4, 0.3, 0.18]):
        f = follow(chord[:, i], 0.7)
        tone_in += level * sum(organ(f * 2 ** (c / 1200)) for c in (-5, 5))
    tone = biquad(tone_in, follow(260 + 1500 * b, 0.12), 0.8, 'lowpass')
    air = biquad(rng.uniform(-1, 1, n), follow(np.where(inhaling, 900 + 500 * b, 500 + 400 * b), 0.3), 0.9, 'bandpass')
    air *= follow(0.05 * moving, 0.15)
    ir_n = 6 * RATE; ir = rng.uniform(-1, 1, ir_n) * (1 - np.arange(ir_n) / ir_n) ** 2.6
    size = 1 << int(np.ceil(np.log2(n + ir_n)))
    verb = np.fft.irfft(np.fft.rfft(tone + air, size) * np.fft.rfft(ir, size), size)[:n]
    verb *= 0.00125 / np.sqrt(np.mean(ir ** 2)) * 44100 / RATE  # how a ConvolverNode normalises its response
    level = np.ones(n); level[at_(INTRO + 3 * cycle + 1.8):] = 0  # leave(): the master falls to 0
    out = (tone * 0.45 + verb * 0.7 + air) * follow(level * 0.32, 0.35) * (1 - np.exp(-t / 0.9))
    cut = lambda a, z: out[at_(a):at_(z)]
    return np.concatenate([cut(0, INTRO + OVERLAP), cut(INTRO + cycle, INTRO + 2 * cycle + OVERLAP),
                           cut(INTRO + 3 * cycle, INTRO + 3 * cycle + OUTRO)])

if __name__ == '__main__':
    takes = {name: render(phases) for name, phases in PATTERNS.items()}
    peak = max(np.abs(x).max() for x in takes.values())
    os.makedirs(os.path.join(HERE, '..', 'sounds'), exist_ok=True)
    for name, x in takes.items():  # one gain for all three, so the patterns play equally loud
        path = os.path.join(HERE, '..', 'sounds', f'drone-{name}.wav')
        with wave.open(path, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes((x / peak * 0.9 * 32767).astype('<i2').tobytes())
        print(path, f'{len(x) / RATE:.2f} s')
