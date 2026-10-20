// A theme is a folder of clips under sounds/<id>/ (built by scripts/sounds.py) plus its calls;
// add one here, to plugin.json's theme options and to SOURCES in the script.
export type Call = { text: string; clip: string; when?: string }
export type Theme = {
  id: string
  name: string // how the prompt section names the voice
  spree: readonly Call[] // the streak's rungs, the mod's own; the last repeats
  calls: readonly Call[] // what Claude picks from, each with when it fits
}

// One "when" per clip id, shared by every theme that has the clip: what the finished task looked like.
const WHEN: Record<string, string> = {
  headshot: 'one precise fix', accuracy: 'one precise fix', doublekill: 'two things done', triplekill: 'three things done',
  multikill: 'several parts landed', megakill: 'a big multi-part job', ultrakill: 'a bigger one, all green',
  monsterkill: 'a huge job, all green', ludicrouskill: 'an absurdly large job', holyshit: 'far beyond the ask',
  nicecatch: 'caught a bug before it shipped', eagleeye: 'spotted a subtle bug', denied: 'stopped a bad change or premise',
  takenlead: 'green again after red', assist: "helped the user's own fix", winner: 'shipped or deployed',
  wonmatch: 'shipped or deployed', youwin: 'shipped or deployed', flawless: 'right first try, nothing to fix',
  perfect: 'right first try, nothing to fix', hattrick: 'third of a kind in a row', lastsecondsave: 'saved at the last moment',
  averted: 'dodged a disaster', brutalmatch: 'a long hard fight', topgun: 'the best possible result',
  pancake: 'flattened a tangled mess', humiliation: 'a trivial fix for a nasty bug', eliminated: 'a bug gone for good',
  obsolete: 'old code replaced', useless: 'dead code deleted', stepaside: 'a rewrite took over', superior: 'a better design',
  perfection: 'right first try, nothing to fix', bowdown: 'a huge win', fearme: 'a scary job done',
  inferior: 'beat a slower way', myhouse: 'a codebase-wide cleanup', hadtohurt: 'a painful migration',
}

const call = (text: string, clip: string): Call => ({ text, clip, when: WHEN[clip] })
const LADDER = [
  call('FIRST BLOOD', 'firstblood'), call('KILLING SPREE', 'killingspree'), call('RAMPAGE', 'rampage'),
  call('DOMINATING', 'dominating'), call('UNSTOPPABLE', 'unstoppable'), call('GODLIKE', 'godlike'),
]
const KILLS = [
  call('HEADSHOT', 'headshot'), call('DOUBLE KILL', 'doublekill'), call('MULTI KILL', 'multikill'),
  call('MEGA KILL', 'megakill'), call('MONSTER KILL', 'monsterkill'),
]
const UT2K = [
  call('LUDICROUS KILL', 'ludicrouskill'), call('HOLY SHIT', 'holyshit'), call('FLAWLESS VICTORY', 'flawless'),
  call('HAT TRICK', 'hattrick'), call('LAST SECOND SAVE', 'lastsecondsave'), call('WON THE MATCH', 'wonmatch'),
]

export const THEMES: Record<string, Theme> = {
  ut99: {
    id: 'ut99', name: 'UT99 announcer', spree: LADDER,
    calls: [
      ...KILLS, call('TRIPLE KILL', 'triplekill'), call('ULTRA KILL', 'ultrakill'), call('NICE CATCH', 'nicecatch'),
      call('TAKEN THE LEAD', 'takenlead'), call('ASSIST', 'assist'), call('WINNER', 'winner'),
    ],
  },
  ut2003: {
    id: 'ut2003', name: 'UT2003 announcer', spree: [...LADDER, call('WICKED SICK', 'wickedsick')],
    calls: [
      ...KILLS, call('TRIPLE KILL', 'triplekill'), call('ULTRA KILL', 'ultrakill'), ...UT2K,
      call('NARROWLY AVERTED', 'averted'), call('BRUTAL MATCH', 'brutalmatch'),
    ],
  },
  'ut2004-female': {
    id: 'ut2004-female', name: 'UT2004 female announcer', spree: [...LADDER, call('WICKED SICK', 'wickedsick')],
    calls: [
      ...KILLS, ...UT2K, call('DENIED', 'denied'), call('EAGLE EYE', 'eagleeye'), call('TOP GUN', 'topgun'),
      call('PANCAKE', 'pancake'),
    ],
  },
  xan: {
    id: 'xan', name: 'Xan, the UT99 boss', spree: [call('NEXT', 'next'), call('BOOM', 'boom'), call('BURN BABY', 'burnbaby')],
    calls: [
      call('ELIMINATED', 'eliminated'), call('OBSOLETE', 'obsolete'), call('USELESS', 'useless'), call('STEP ASIDE', 'stepaside'),
      call('SUPERIOR', 'superior'), call('INFERIOR', 'inferior'), call('PERFECTION', 'perfection'), call('BOW DOWN', 'bowdown'),
      call('FEAR ME', 'fearme'), call('MY HOUSE', 'myhouse'), call('HAD TO HURT', 'hadtohurt'),
    ],
  },
  quake3: {
    id: 'quake3', name: 'Quake III announcer', spree: [call('EXCELLENT', 'excellent'), call('IMPRESSIVE', 'impressive')],
    calls: [
      call('ACCURACY', 'accuracy'), call('PERFECT', 'perfect'), call('DENIED', 'denied'), call('HUMILIATION', 'humiliation'),
      call('TAKEN THE LEAD', 'takenlead'), call('YOU WIN', 'youwin'),
    ],
  },
}
