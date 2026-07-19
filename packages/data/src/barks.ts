// Unit barks and event lines. Deadpan liturgical — see docs/WORLD_BIBLE.md
// §6 for the approved and banned joke formats. All timing in ticks.

export interface BarkSet {
  onSelect: readonly string[];
  onMove: readonly string[];
  onAttack: readonly string[];
  onDeath: readonly string[];
}

export const BARK_COOLDOWN_TICKS = 60;

export const BARKS: Readonly<Record<string, BarkSet>> = {
  clubgoer: {
    onSelect: ['Is time real?', 'The lineup doesn’t matter. It’s about the vibe.', '…'],
    onMove: ['To the floor.', 'This is my song. It has no melody.', 'One more hour.'],
    onAttack: ['I’m a lover, not— okay fine.', 'This is NOT the vibe.'],
    onDeath: ['Tell coat check… ticket 419…', 'Going home. Voluntarily. Definitely.'],
  },
  bouncer: {
    onSelect: ['…', 'Ja?', '(nods, almost imperceptibly)'],
    onMove: ['Mm.', '(walks like a verdict)'],
    onAttack: ['Heute leider nicht.', 'The list says no.', 'No reason will be given.'],
    onDeath: ['Someone… watch the door…', '(permanent ban, self-inflicted)'],
  },
  strobe_acolyte: {
    onSelect: ['Lights ready.', 'Do you accept flicker into your life?'],
    onMove: ['Repositioning the rig.', 'Cable run permitting.'],
    onAttack: ['EYES FRONT.', 'Strobe warning is a courtesy, not a rule.'],
    onDeath: ['Fading… to black… professionally…'],
  },
  front_left_monk: {
    onSelect: ['…', '…', 'Six hours. Same spot. Transcendent.'],
    onMove: ['(relocates without breaking the two-step)'],
    onAttack: ['(disapproving stillness, at speed)'],
    onDeath: ['The loop… continues… without me…'],
  },
  bass_cannon: {
    onSelect: ['Sub is warm.', 'Point me at something structural.'],
    onMove: ['Rolling the rig.', 'Mind the wheels. Mind the WALLS.'],
    onAttack: ['FEEL IT IN YOUR TEETH.'],
    onDeath: ['the… low end… gone…'],
  },
  roadie: {
    onSelect: ['It’s not a cable problem.', 'It’s ALWAYS a cable problem.'],
    onMove: ['Running a line.', 'Load in. Load out. Forever.'],
    onAttack: ['This is outside my job description. Like everything.'],
    onDeath: ['Check… channel two…'],
  },
  kapitein_hak: {
    onSelect: ['MAAT!', 'The feet are ready.'],
    onMove: ['Forward. Obviously.'],
    onAttack: ['HAKKUH!', 'COME HERE. HUG. AFTER.'],
    onDeath: ['tell them… it was… a good hug…'],
  },
  undercover_cop: {
    onSelect: ['(adjusts lanyard)'],
    onMove: ['(walks like a rental car)'],
    onAttack: ['Right then. Names. NAMES.'],
    onDeath: ['tell the precinct… the drop was… decent…'],
  },
  feral_gabber: {
    onSelect: ['?????'],
    onMove: ['(vibrates toward you)'],
    onAttack: ['WAAR IS DAT FEESTJE'],
    onDeath: ['back… to the… field…'],
  },
  chief_inspector: {
    onSelect: ['Decibels noted.'],
    onMove: ['(measures while walking)'],
    onAttack: ['Section 63. With prejudice.'],
    onDeath: ['my records… four hundred… of them…'],
  },
  resident_dj: {
    onSelect: ['The USB is safe.', 'Quick b2b?', 'I only play sets, not tracks.'],
    onMove: ['Walking. Like a normal person. Being perceived.'],
    onAttack: ['This one’s an edit. MY edit.', 'ID? No IDs. Ever.'],
    onDeath: ['The USB… is in… the other bag…'],
  },
  clubgoer_harvest: {
    onSelect: [],
    onMove: ['Back of the queue. Again. Fine.'],
    onAttack: [],
    onDeath: [],
  },
  gabber: {
    onSelect: ['MATE!', 'HAKKUH!', 'WHERE’S AMSTERDAM THEN?'],
    onMove: ['(arrives before the order finishes)'],
    onAttack: ['HAKKUH HAKKUH HAKKUH—'],
    onDeath: ['hug… mandatory… cultural…'],
  },
  hakken_bruiser: {
    onSelect: ['Mate.', 'Wall? What wall.'],
    onMove: ['Forward. The only direction we know.'],
    onAttack: ['COME HERE. HUG. AFTER.'],
    onDeath: ['Tell the Energiehal… I tried…'],
  },
  uptempo_screamer: {
    onSelect: ['220 AND CLIMBING.', 'faster Faster FASTER'],
    onMove: ['(vibrates in a direction)'],
    onAttack: ['MASONRY IS A SOCIAL CONSTRUCT.'],
    onDeath: ['too… slow… ironic…'],
  },
};

export const EVENT_LINES = {
  raidIncoming: [
    'Councillor Decibel has dispatched inspectors. They know the lineup. They’re still coming.',
    'Noise complaint escalated. The Repetitive Beats Act is being read aloud, at volume.',
  ],
  lowCash: ['The bar is empty. The €9 water stands unsold. Grim.'],
  lowVibe: ['The floor is thinning. Someone said “one more hour” and left.'],
  buildingComplete: ['Construction complete. The cable run is load-bearing and emotional.'],
  underAttack: ['The club is under attack. The smoking area has not noticed.'],
} as const;
