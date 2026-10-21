// How hot one prompt reads, 0-6, from what was typed. English and Portuguese.
// Anger is frustrated phrases, insults, shouting, and swearing aimed at something: at you ("fuck you"), at what
// broke ("fucking broken again"), or a bare outburst ("porra."). Any other swear only amplifies, so casual
// swearing ("explain it fucking better", "holy shit it works") never builds up past the trigger.

const SWEAR = /^(fuck\w*|motherfuck\w*|shit\w*|bullshit|damn\w*|goddamn\w*|crap\w*|porra\w*|caralh\w*|merda\w*|puta\w*|fod\w*|vsf|fdp|vtnc|krl|cacete|bosta\w*)$/i
const INSULTS = /\b(imbecile\w*|imbecil|idiot\w*)\b/gi
const FRUSTRATED = /\b(wtf|ffs|pqp|again\?|still (not|broken|wrong|failing|the same|doesn'?t|isn'?t)|how many times|i (already )?told you|are you (kidding|serious)|seriously\?|what the (hell|heck|fuck)|wrong again|useless|for the \w+ time|(doesn'?t|does not|still not) work|de novo|ainda (n[aã]o|errado|quebrado)|n[aã]o funciona|quantas vezes|(eu )?j[aá] (te )?(disse|falei)|t[aá] de brincadeira)/gi
const CODE = /```[\s\S]*?```|`[^`\n]*`/g // pasted code is not the person talking

// What a swear is aimed at, within a couple of words of it in the same sentence; and what makes it glee.
const AT_YOU = /\b(you|u|ya|your|yours|you'?re|voc[eê]|vc|tu|teu|tua)\b|\bfuck\w*\s+off\b|\bvai\s+(se|te)\s+f/i
const AIMED = /^(vsf|fdp|vtnc)$/i // "vai se foder", "filho da puta", "vai tomar no cu": aimed by what they say
const BROKEN = /\b(broken|broke|breaks|breaking|fail\w*|crash\w*|wrong|bug\w*|errors?|useless|garbage|mess|again|still|doesn'?t work|does not work|(not|isn'?t|won'?t) work\w*|quebr\w*|errad\w*|errou|falh\w*|lixo|in[uú]til|de novo|ainda|n[aã]o funciona)\b/i
const GLAD = /\b(works?|worked|nice|great|awesome|amazing|love\w*|cool|yeah|yes|perfect|beautiful|brilliant|nailed|finally|good|thanks?|thank you|lol|haha\w*|lindo|[oó]timo|perfeito|massa|boa|valeu|demais|funcionou)\b/i

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0
// Repeats compound: 1 → 1, 2 → 2.8, 3 → 5.2 (the total is capped at 6 anyway)
const repeats = (n: number) => n ** 1.5

// Each sentence's swears: all of them (amplifiers), and those aimed at something (anger on their own). A
// sentence that is half swears is an outburst, once, unless the prompt is glad.
export const swearing = (text: string) => {
  let all = 0, aimed = 0
  const glad = GLAD.test(text)
  for (const sentence of text.split(/[.!?;\n]+/)) {
    const words = sentence.match(/[\p{L}']+/gu) ?? []
    const near = (i: number, d: number) => words.slice(Math.max(0, i - d), i + d + 1).join(' ')
    const swears = words.flatMap((w, i) => (SWEAR.test(w) ? [i] : []))
    all += swears.length
    let hits = 0
    for (const i of swears) {
      const broken = BROKEN.test(near(i, 3))
      if (GLAD.test(near(i, 3)) && !broken) continue
      if (AIMED.test(words[i]!) || AT_YOU.test(near(i, 2)) || broken) hits++
    }
    aimed += hits
    if (hits === 0 && swears.length > 0 && swears.length * 2 >= words.length && !glad) aimed++
  }
  return { all, aimed }
}

// insults.local.txt (gitignored): one regex fragment a line, `#` comments; scored as INSULTS, a bad line skipped.
export const localInsults = (text: string): RegExp | undefined => {
  const valid = (line: string) => { try { new RegExp(line); return true } catch { return false } }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#') && valid(l))
  return lines.length > 0 ? new RegExp(`\\b(${lines.join('|')})\\b`, 'gi') : undefined
}

export const heat = (prompt: string, extra?: RegExp): number => {
  const text = prompt.replace(CODE, ' ')
  const letters = text.match(/\p{L}/gu) ?? []
  const upper = letters.filter(c => c !== c.toLowerCase()).length / Math.max(1, letters.length)
  // 0 below 60% caps; 2 at 60%, rising to 3 at all caps (8+ letters)
  const shouting = letters.length >= 8 && upper >= 0.6 ? 2 + Math.min(1, (upper - 0.6) / 0.4) : 0
  const swears = swearing(text)
  const directed = count(text, FRUSTRATED) + count(text, INSULTS) + (extra ? count(text, extra) : 0) + swears.aimed
  if (directed === 0 && shouting === 0) return 0
  const longestMarks = Math.max(0, ...(text.match(/[!?]+/g) ?? []).map(run => run.length))
  const marks = longestMarks >= 5 ? 2 : longestMarks >= 2 ? 1 : 0
  return Math.min(6, repeats(directed) + shouting + repeats(swears.all) + marks)
}
