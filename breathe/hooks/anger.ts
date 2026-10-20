// How hot one prompt reads, 0-6, from what was typed. English and Portuguese.
// Anger is frustrated phrases, insults and shouting. Swears and !!!/?? only amplify it: on their own
// they score 0, since casual swearing every minute would otherwise build up past the trigger.

const SWEARS = /\b(fuck\w*|motherfuck\w*|shit\w*|bullshit|damn\w*|goddamn\w*|crap\w*|porra\w*|caralh\w*|merda\w*|puta\w*|vsf|fdp|krl|cacete|bosta\w*)\b/gi
const INSULTS = /\b(imbecile\w*|imbecil|idiot\w*)\b/gi
const FRUSTRATED = /\b(wtf|ffs|pqp|again\?|still (not|broken|wrong|failing|the same|doesn'?t|isn'?t)|how many times|i (already )?told you|are you (kidding|serious)|seriously\?|what the (hell|heck)|wrong again|useless|for the \w+ time|(doesn'?t|does not|still not) work|de novo|ainda (n[aã]o|errado|quebrado)|n[aã]o funciona|quantas vezes|(eu )?j[aá] (te )?(disse|falei)|t[aá] de brincadeira)/gi
const CODE = /```[\s\S]*?```|`[^`\n]*`/g // pasted code is not the person talking

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0
// Repeats compound: 1 → 1, 2 → 2.8, 3 → 5.2 (the total is capped at 6 anyway)
const repeats = (n: number) => n ** 1.5

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
  const directed = count(text, FRUSTRATED) + count(text, INSULTS) + (extra ? count(text, extra) : 0)
  if (directed === 0 && shouting === 0) return 0
  const longestMarks = Math.max(0, ...(text.match(/[!?]+/g) ?? []).map(run => run.length))
  const marks = longestMarks >= 5 ? 2 : longestMarks >= 2 ? 1 : 0
  return Math.min(6, repeats(directed) + shouting + repeats(count(text, SWEARS)) + marks)
}
