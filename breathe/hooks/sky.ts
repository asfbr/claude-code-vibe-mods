// The breath's timeline and its picture as terminal cells: a soft glow in each cell's background,
// the nebula's contour lines and the dust as braille dots over it. Ported from ui/breathe.html.
import type { Run } from '../types'

export const PATTERNS: Record<string, [Kind, number][]> = {
  '4-6': [['in', 4], ['out', 6]],
  'box': [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]],
  '4-7-8': [['in', 4], ['hold', 7], ['out', 8]],
}
export const INTRO = 1.6 // seconds of "settle in" before the first breath
export const GOODBYE = 1.8 // "well done" holds this long, then the picture fades
export const FADE = 1.4

type Kind = 'in' | 'hold' | 'out'
type Hue = 'in' | 'full' | 'out' | 'empty'
type RGB = [number, number, number]

// Each phase its own light, core to edge, blended as one phase turns into the next.
const HUES: Record<Hue, [RGB, RGB]> = {
  in: [[168, 228, 255], [84, 112, 255]],
  full: [[218, 182, 255], [116, 84, 236]],
  out: [[255, 204, 140], [232, 96, 124]],
  empty: [[150, 160, 246], [64, 74, 176]],
}
const BLEND = 1.6 // seconds a phase takes to reach its colours
const WORDS: Record<Kind, string> = { in: 'breathe in', hold: 'hold', out: 'breathe out' }
const SKY: RGB = [4, 5, 11]
const WHITE: RGB = [255, 255, 255]

const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export const phasesOf = (pattern: string) => PATTERNS[pattern] ?? PATTERNS['4-6']!
export const cycleSeconds = (pattern: string) => phasesOf(pattern).reduce((s, [, d]) => s + d, 0)
export const cyclesFor = (pattern: string, seconds: number) => Math.max(1, Math.round(seconds / cycleSeconds(pattern)))
// From the first frame to the last: intro, the breaths, the goodbye and its fade.
export const runSeconds = (run: Run) => INTRO + run.cycles * cycleSeconds(run.pattern) + GOODBYE + FADE

export type Moment = {
  label: string; count: string; done: number // done: whole breaths finished
  b: number; motion: number; progress: number // fullness 0-1, its speed 0-1, the phase's timer 0-1
  stirred: number // the breath's movement so far, which drives the dust
  colors: [RGB, RGB]; light: number // fades in at the start, out after the goodbye
}

// Where the breath is `time` seconds after the run started. Pure: any frame can be drawn on its own.
export function moment(run: Run, time: number): Moment {
  const phases = phasesOf(run.pattern), cycleSec = cycleSeconds(run.pattern)
  const light = Math.min(1, time / FADE, Math.max(0, (runSeconds(run) - time) / FADE))
  const t = time - INTRO
  const moved = phases.filter(([k]) => k !== 'hold').length // in and out each move the breath by 1
  if (t < 0) return { label: 'settle in', count: '', done: 0, b: 0, motion: 0, progress: 0, stirred: 0, colors: HUES.empty, light }
  const cycle = Math.floor(t / cycleSec)
  if (cycle >= run.cycles) {
    const [kind] = phases.at(-1)!, last = kind === 'hold' ? (phases.at(-2)![0] === 'in' ? 'full' : 'empty') : kind
    return { label: 'well done', count: '', done: run.cycles, b: 0, motion: 0, progress: 0,
      stirred: run.cycles * moved * 2.5, colors: HUES[last], light }
  }
  let into = t - cycle * cycleSec, i = 0, stirred = cycle * moved
  while (into >= phases[i]![1]) { if (phases[i]![0] !== 'hold') stirred++; into -= phases[i++]![1] }
  const [kind, dur] = phases[i]!, p = into / dur
  const before = phases[(i + phases.length - 1) % phases.length]!
  const hueOf = (k: Kind, prev: Kind): Hue => k === 'hold' ? (prev === 'in' ? 'full' : 'empty') : k
  const hue = hueOf(kind, before[0])
  const from = cycle === 0 && i === 0 ? HUES.empty
    : HUES[hueOf(before[0], phases[(i + phases.length - 2) % phases.length]![0])]
  const blend = ease(Math.min(1, into / BLEND))
  const b = kind === 'in' ? ease(p) : kind === 'out' ? 1 - ease(p) : hue === 'full' ? 1 : 0
  // |db/dt| over 0.4 per second, as the page measured it; its integral is 2.5 per in or out.
  const motion = kind === 'hold' ? 0 : Math.min(1, (Math.PI / 2) * Math.sin(Math.PI * p) / dur / 0.4)
  if (kind !== 'hold') stirred += ease(p)
  return { label: WORDS[kind], count: String(Math.ceil(dur - into)), done: cycle, b, motion, progress: p,
    stirred: stirred * 2.5, colors: [lerp(from[0], HUES[hue][0], blend), lerp(from[1], HUES[hue][1], blend)], light }
}

// The nebula: uneven contour lines, each wavy by its own few sines, and dust on slow orbits.
const RINGS = 15, MOTES = 150, TIMER_RING = 7
const seed = (n => () => (n = (n * 16807) % 2147483647) / 2147483647)(9301)
const rings = Array.from({ length: RINGS }, () => ({
  waves: [1, 2, 3, 5, 7].map((k, i) => ({ k, amp: [0.55, 0.5, 0.35, 0.22, 0.12][i]! * (0.6 + 0.8 * seed()),
    phase: seed() * Math.PI * 2, speed: (seed() - 0.5) * (0.5 + 0.25 * k) })),
  tilt: seed() * Math.PI * 2,
}))
const motes = Array.from({ length: MOTES }, () => ({
  angle: seed() * Math.PI * 2, reach: 1.15 + seed() ** 1.6 * 1.6,
  twinkle: 0.6 + seed() * 2.2, phase: seed() * Math.PI * 2,
}))
const wobble = (ring: typeof rings[number], a: number, time: number) => {
  let w = 0
  for (const v of ring.waves) w += v.amp * Math.sin(v.k * (a + ring.tilt) + v.phase + time * v.speed)
  return w
}

// Braille: each cell is 2 dots across and 4 down, so the dot grid is about square on a 1:2 cell.
const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
const DEFAULT = 0x01000000
// The terminal shows 1024 colour pairs at once: steps of 6 keep a frame well under that, banded on purpose.
const pack = (c: RGB, k = 1) =>
  (Math.min(255, Math.round(c[0] * k / 6) * 6) << 16) | (Math.min(255, Math.round(c[1] * k / 6) * 6) << 8) | Math.min(255, Math.round(c[2] * k / 6) * 6)

// One frame, `columns` x `rows` cells, row-major [codePoint, foreground, background] (RasterProps).
export function paint(m: Moment, time: number, columns: number, rows: number): Uint32Array {
  const W = columns * 2, H = rows * 4, cx = W / 2, cy = H / 2
  const S = Math.min(W, H) / 2 * 1.05 // the page's half-size; the outermost line reaches about 0.93 S
  const R = S * (0.3 + 0.36 * m.b)
  const [core, edge] = m.colors
  const dots = new Uint8Array(columns * rows), ink = new Float32Array(columns * rows * 3), inkA = new Float32Array(columns * rows)
  const plot = (x: number, y: number, c: RGB, a: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return
    const cell = (yi >> 2) * columns + (xi >> 1)
    dots[cell]! |= DOT[yi & 3]![xi & 1]!
    if (a > inkA[cell]!) { inkA[cell] = a; ink[cell * 3] = c[0]; ink[cell * 3 + 1] = c[1]; ink[cell * 3 + 2] = c[2] }
  }
  // Each line drifts off-centre on its own slow orbit, so the set never settles into neat circles.
  const line = (j: number) => {
    const f = j / (RINGS - 1), off = R * (0.03 + 0.06 * f), spin = time * 0.21 * (1 + (j % 3) * 0.4) + j * 1.7
    return { x: cx + off * Math.cos(spin), y: cy + off * Math.sin(spin * 1.3), r: R * (0.55 + 0.85 * f),
      amp: (0.045 + 0.1 * f ** 1.2) * (0.7 + 0.9 * m.motion), f }
  }
  const trace = (j: number, c: RGB, a: number, upTo = 1) => {
    const { x, y, r, amp } = line(j), steps = Math.ceil(r * 2 * Math.PI * 1.5 * upTo)
    for (let i = 0; i <= steps; i++) {
      const ang = (i / steps) * upTo * Math.PI * 2 - Math.PI / 2, rr = r * (1 + amp * wobble(rings[j]!, ang, time))
      plot(x + rr * Math.cos(ang), y + rr * Math.sin(ang), c, a)
    }
  }
  for (let j = 1; j < RINGS; j += 2) { // every other line: at a few dots per line all 15 run together
    const f = j / (RINGS - 1)
    trace(j, lerp(core, edge, f), 0.18 + 0.82 * (1 - f) ** 1.5)
  }
  if (m.progress > 0) trace(TIMER_RING, lerp(core, WHITE, 0.25), 1.6, m.progress) // the phase's timer
  for (const d of motes) { // gathered close when the lungs are full, scattered when empty
    const angle = d.angle + (0.042 * time + 0.24 * m.stirred) / d.reach
    const dist = S * (0.62 + (d.reach - 0.55) * (1.15 - 0.55 * m.b))
    const a = (0.18 + 0.32 * (0.5 + 0.5 * Math.sin(time * d.twinkle + d.phase))) * (0.5 + 0.5 * m.b)
    plot(cx + dist * Math.cos(angle), cy + dist * Math.sin(angle) * 0.92, lerp(core, WHITE, 0.5), a * 1.6)
  }

  // The light under the lines: the sky, the glow, and the body inside the innermost line, all added.
  // No vignette: at these levels a step of 6 shows as a ring.
  const glowR = R * 2.2, scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
  const field = (x: number, y: number): RGB => {
    const d = Math.hypot(x, y), c: RGB = [...SKY], g = d / glowR
    const add = (l: RGB) => { c[0] += l[0]; c[1] += l[1]; c[2] += l[2] }
    if (g < 1) add(g < 0.35 ? lerp(scale(core, 0.32), scale(edge, 0.14), g / 0.35) : scale(edge, 0.14 * (1 - (g - 0.35) / 0.65)))
    const inner = R * (1 + (0.05 + 0.05 * m.motion) * wobble(rings[0]!, Math.atan2(y, x), time * 0.6))
    if (d < inner) {
      const t = Math.hypot(x + R * 0.15, y + R * 0.2) / (R * 1.05)
      add(t < 0.6 ? lerp(scale(lerp(core, WHITE, 0.35), 0.5), scale(core, 0.2), t / 0.6)
        : lerp(scale(core, 0.2), scale(edge, 0.04), Math.min(1, (t - 0.6) / 0.4)))
    }
    return c
  }
  // A cell with dots is braille over its light; one without is a half block, its two halves lit apart.
  const out = new Uint32Array(columns * rows * 3)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const cell = row * columns + col, x = col * 2 + 1 - cx
      const top = pack(field(x, row * 4 + 1 - cy), m.light), bottom = pack(field(x, row * 4 + 3 - cy), m.light)
      const bits = dots[cell]!, a = inkA[cell]!
      if (bits) {
        const bg = field(x, row * 4 + 2 - cy)
        out[cell * 3] = 0x2800 + bits
        out[cell * 3 + 1] = pack([bg[0] + ink[cell * 3]! * a, bg[1] + ink[cell * 3 + 1]! * a, bg[2] + ink[cell * 3 + 2]! * a], m.light)
        out[cell * 3 + 2] = pack(bg, m.light)
      } else {
        out[cell * 3] = top === bottom ? 0x20 : 0x2580
        out[cell * 3 + 1] = top === bottom ? DEFAULT : top
        out[cell * 3 + 2] = bottom
      }
    }
  }
  return out
}

// The engine has Uint8Array.toBase64 (its own examples use it); TypeScript's es2023 lib does not declare it yet.
export const encode = (cells: Uint32Array) => (new Uint8Array(cells.buffer) as Uint8Array & { toBase64(): string }).toBase64()
