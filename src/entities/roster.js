/**
 * ══════════════════════════════════════════════════════════════════
 *  THE ROSTER — 5 operators per faction
 * ══════════════════════════════════════════════════════════════════
 *
 * Design rules the roster follows:
 *
 *  1. Every operator is legible at 30 m by SILHOUETTE alone (build, headgear,
 *     what they carry) — you should know what's about to happen to you before
 *     you can read a healthbar.
 *  2. Each faction covers the same five pillars — Recon, Heavy, Marksman,
 *     Disruptor, Support — so both sides play fair, but the *flavour* of each
 *     pillar is opposite. The hill improvises; the battalion is issued.
 *  3. One passive that changes how you MOVE or SHOOT constantly, and one
 *     active that changes how the FIGHT reads for a few seconds.
 *  4. Nobody is a hard counter to anybody. Speed pays for fragility, armour
 *     pays for speed, damage pays for range.
 *
 * Passives carry a stable `id`. Gameplay code branches on that id and never
 * on the display name — renaming an operator's perk must never silently
 * change how it behaves.
 *
 * All names, crews and units are invented for this game.
 */

/**
 * ── THE HILL ──
 *
 * Morro do Cruzeiro. Four thousand people stacked up a granite slope above the
 * city. One road reaches the bottom of it; above that there is nothing but the
 * Escadão — nine hundred concrete steps switchbacking to a whitewashed cross at
 * the summit — and the lanes that branch off it.
 *
 * Bolted to the water tower at the top is a transmitter. It carries the
 * Saturday baile, and it carries the lookouts: when a patrol turns off the
 * coast road the music cuts and a voice says which gate. It is how the hill
 * talks to itself.
 *
 * The eviction notices are served Monday. The Battalion is coming up tonight to
 * take the tower before they are. The crew has until dawn.
 *
 * Everything here is invented — the hill, the crews, the unit, the city.
 */
export const FACTIONS = {
  gang: {
    id: 'gang',
    name: 'The Lookouts',
    short: 'LOOKOUTS',
    motto: 'The hill sees first',
    blurb: 'Born on these steps. No armour, no radios worth the name — but they '
      + 'know which roof carries weight and which alley is a dead end, and the '
      + 'tower tells them you are coming before you have parked.',
    color: 0xffd23f,
    css: '#ffd23f',
    accent: '#ff5a1f',
  },
  police: {
    id: 'police',
    name: '9th Battalion',
    short: 'BATTALION',
    motto: 'Up before dawn',
    blurb: 'Issued plates, issued rifles, a printed map three years out of date. '
      + 'Nine hundred steps of somebody else\'s ground, and every window above '
      + 'them belongs to a stranger.',
    color: 0x4ea3ff,
    css: '#37b6ff',
    accent: '#0b64c8',
  },
};

/**
 * stats
 *   health / armor : armour absorbs 65% of incoming damage until it's gone
 *   speed          : multiplier on the 4.6 m/s base jog
 *   control        : recoil recovery + bloom decay multiplier
 */
export const ROSTER = [
  /* ══════════════ THE HILLSIDE CREW ══════════════ */
  {
    id: 'kite', faction: 'gang', name: 'Kite', role: 'Recon',
    tag: 'THE LOOKOUT',
    bio: 'Fifteen years old and the fastest thing on the hill. Flies a kite off the water tanks to signal — one colour means a patrol, two means a raid. Has never once been caught on the stairs.',
    quote: '“If the kite goes up, run.”',
    stats: { health: 85, armor: 0, speed: 1.18, control: 1.0 },
    loadout: ['smg', 'pistol'],
    grenades: 2,
    build: { frame: 'light', headgear: 'cap', extra: 'kite' },
    passive: {
      id: 'rooftops', name: 'Rooftops', icon: 'run',
      desc: '+40% jump height, no fall damage from short drops, and your footsteps are near-silent.',
    },
    ability: {
      id: 'reveal', name: 'Kite Line', cooldown: 24, duration: 7, icon: 'kite', radius: 999,
      desc: 'Send the kite up. Every hostile is outlined through walls for 7 seconds — for you and your crew.',
    },
    diff: 2,
  },
  {
    id: 'boulder', faction: 'gang', name: 'Boulder', role: 'Heavy',
    tag: 'THE DOOR',
    bio: 'Stands at the mouth of the alley so nobody else has to. Carries a shortened pump gun and a sheet of road sign he calls a shield.',
    quote: '“Go through me, then.”',
    stats: { health: 150, armor: 60, speed: 0.86, control: 0.9 },
    loadout: ['shotgun', 'pistol'],
    grenades: 1,
    build: { frame: 'heavy', headgear: 'bandana', extra: 'plate' },
    passive: {
      id: 'thickHide', name: 'Thick Hide', icon: 'shield',
      desc: 'Take 25% less damage and never get staggered by incoming fire.',
    },
    ability: {
      id: 'barricade', name: 'Barricade', cooldown: 26, duration: 16, icon: 'barrier',
      desc: 'Drop a scrap-metal barricade where you stand. Solid cover for you and the crew.',
    },
    diff: 1,
  },
  {
    id: 'queen', faction: 'gang', name: 'Queen', role: 'Marksman',
    tag: 'THE PATIENCE',
    bio: 'Sits cross-legged on the highest water tank for hours. Calm to the point of unnerving. The hill goes quiet when she starts working.',
    quote: '“One at a time.”',
    stats: { health: 100, armor: 20, speed: 1.0, control: 1.35 },
    loadout: ['rifle', 'pistol'],
    grenades: 1,
    build: { frame: 'normal', headgear: 'bandana', extra: 'sling' },
    passive: {
      id: 'breathControl', name: 'Breath Control', icon: 'scope',
      desc: 'Aiming while crouched removes bullet bloom completely. +30% headshot damage.',
    },
    ability: {
      id: 'focus', name: 'Eagle Eye', cooldown: 22, duration: 7, icon: 'eye', radius: 0,
      desc: 'Zoom in hard. Perfect accuracy, +35% damage, and time seems to slow while you hold your breath.',
    },
    diff: 3,
  },
  {
    id: 'smoke', faction: 'gang', name: 'Smoke', role: 'Disruptor',
    tag: 'THE FIREWORKS',
    bio: 'Used to run the midwinter festival fireworks. Same skill set, different season. Everything he throws makes the police stop moving forward.',
    quote: '“Festival season all year round.”',
    stats: { health: 100, armor: 10, speed: 1.06, control: 1.0 },
    loadout: ['smg', 'pistol'],
    grenades: 4,
    build: { frame: 'normal', headgear: 'cap', extra: 'bandolier' },
    passive: {
      id: 'pyro', name: 'Pyrotechnics', icon: 'burst',
      desc: 'Carry double throwables and deal +35% explosive damage. Grenades cook faster.',
    },
    ability: {
      id: 'molotov', name: 'Molotov', cooldown: 15, duration: 9, icon: 'fire',
      desc: 'Throw a bottle that leaves a pool of fire. Nothing crosses it without burning.',
    },
    diff: 2,
  },
  {
    id: 'doc', faction: 'gang', name: 'Doc', role: 'Support',
    tag: 'THE STITCHES',
    bio: 'Two years of medical school and a back room full of supplies. Half the hill owes him a scar that healed clean. Fights only when he has to — but he has to a lot.',
    quote: '“Sit down. This is going to sting.”',
    stats: { health: 110, armor: 20, speed: 1.0, control: 1.1 },
    loadout: ['smg', 'pistol'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'none', extra: 'medbag' },
    passive: {
      id: 'steadyHands', name: 'Steady Hands', icon: 'hands',
      desc: 'Regenerate health three times faster out of combat, and start regenerating twice as soon.',
    },
    ability: {
      id: 'medkit', name: 'Field Kit', cooldown: 20, duration: 14, icon: 'kit',
      desc: 'Drop a supply kit. Heals and re-arms you and any crew standing near it.',
    },
    diff: 1,
  },

  /* ══════════════ TACTICAL BATTALION ══════════════ */
  {
    id: 'duarte', faction: 'police', name: 'Capt. Duarte', role: 'Assault',
    tag: 'THE ORDER',
    bio: 'Twenty-two years in, and still first up the stairs. Believes the operation ends when everyone comes back down, which is not the same thing his superiors believe.',
    quote: '“On me. Single file.”',
    stats: { health: 115, armor: 40, speed: 1.0, control: 1.15 },
    loadout: ['rifle', 'pistol'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'helmet', extra: 'radio' },
    passive: {
      id: 'command', name: 'Command', icon: 'radio',
      desc: 'Squadmates within 18 m deal +15% damage. You reload 20% faster.',
    },
    ability: {
      id: 'surge', name: 'Push Up', cooldown: 22, duration: 7, icon: 'push', radius: 20,
      desc: 'Call the push. You and every nearby squadmate get +25% movement and fire rate.',
    },
    diff: 1,
  },
  {
    id: 'stone', faction: 'police', name: 'Sgt. Stone', role: 'Heavy',
    tag: 'THE WALL',
    bio: 'Carries the ballistic shield up eleven flights of stairs without complaining, then complains for an hour afterwards. Nothing gets past the doorway he is standing in.',
    quote: '“Behind me. Everyone.”',
    stats: { health: 160, armor: 80, speed: 0.82, control: 0.88 },
    loadout: ['shotgun', 'pistol'],
    grenades: 1,
    build: { frame: 'heavy', headgear: 'helmet', extra: 'shield' },
    passive: {
      id: 'hardened', name: 'Hardened', icon: 'shield',
      desc: 'Take 30% less damage from the front. Immune to stagger and flashes.',
    },
    ability: {
      id: 'barricade', name: 'Deployable Shield', cooldown: 24, duration: 14, icon: 'barrier',
      desc: 'Plant the ballistic shield. Hard cover in the open, right where the squad needs it.',
    },
    diff: 1,
  },
  {
    id: 'lira', faction: 'police', name: 'Cpl. Lira', role: 'Marksman',
    tag: 'THE ANGLE',
    bio: 'Finds the one window in the plaza that sees three sets of stairs at once, and then does not move for the rest of the operation.',
    quote: '“I have the angle. Go ahead and climb.”',
    stats: { health: 90, armor: 20, speed: 1.02, control: 1.4 },
    loadout: ['rifle', 'pistol'],
    grenades: 1,
    build: { frame: 'light', headgear: 'cap', extra: 'scope' },
    passive: {
      id: 'coldBlood', name: 'Cold Blood', icon: 'cold',
      desc: 'Aimed shots taken while standing perfectly still deal +45% damage.',
    },
    ability: {
      id: 'thermal', name: 'Thermal Optic', cooldown: 21, duration: 8, icon: 'thermal', radius: 999,
      desc: 'Switch to thermal. Hostiles glow through walls while you are aiming down sights.',
    },
    diff: 3,
  },
  {
    id: 'sayuri', faction: 'police', name: 'Lt. Sayuri', role: 'Breacher',
    tag: 'THE DOORWAY',
    bio: 'Goes through the door first because she has decided, permanently and without discussion, that nobody else is going to.',
    quote: '“Door. Flash. In.”',
    stats: { health: 105, armor: 40, speed: 1.07, control: 1.05 },
    loadout: ['shotgun', 'smg'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'helmet', extra: 'breach' },
    passive: {
      id: 'doorDown', name: 'Door Down', icon: 'breach',
      desc: '+35% damage inside 8 m and you bring the sights up 40% faster.',
    },
    ability: {
      id: 'flash', name: 'Flashbang', cooldown: 14, duration: 4, icon: 'bolt',
      desc: 'Throw a flashbang. Anyone looking at it is blind and useless for four seconds.',
    },
    diff: 2,
  },
  {
    id: 'camargo', faction: 'police', name: 'Pvt. Camargo', role: 'Support',
    tag: 'THE EYES',
    bio: 'Runs the drone, carries the ammo, keeps the radio charged. Newest on the team and the only one who has read the whole manual.',
    quote: '“Drone up. Count: six.”',
    stats: { health: 100, armor: 30, speed: 1.0, control: 1.1 },
    loadout: ['smg', 'pistol'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'cap', extra: 'drone' },
    passive: {
      id: 'logistics', name: 'Logistics', icon: 'crate',
      desc: '+60% reserve ammo, and you vacuum up ammo pickups from 6 m away.',
    },
    ability: {
      id: 'drone', name: 'Recon Drone', cooldown: 19, duration: 9, icon: 'drone', radius: 999,
      desc: 'Put the drone up. Marks every hostile on the minimap and outlines the close ones.',
    },
    diff: 1,
  },
];

export const byId = (id) => ROSTER.find((c) => c.id === id);
export const rosterFor = (faction) => ROSTER.filter((c) => c.faction === faction);

/** Grunt archetypes the AI spawns as, tuned per wave difficulty. */
export const GRUNTS = {
  gang: [
    { id: 'soldier',  name: 'Soldier',  weapon: 'smg',     health: 80,  armor: 0,  speed: 1.05, skill: 0.45, score: 100, rank: 'grunt' },
    { id: 'spotter',  name: 'Spotter',  weapon: 'pistol',  health: 65,  armor: 0,  speed: 1.2,  skill: 0.35, score: 80,  rank: 'grunt' },
    { id: 'runner',   name: 'Runner',   weapon: 'shotgun', health: 110, armor: 20, speed: 0.95, skill: 0.5,  score: 150, rank: 'grunt' },
    { id: 'enforcer', name: 'Enforcer', weapon: 'rifle',   health: 120, armor: 40, speed: 1.0,  skill: 0.68, score: 240, rank: 'elite' },
    { id: 'warlord',  name: 'Warlord',  weapon: 'rifle',   health: 180, armor: 80, speed: 0.92, skill: 0.8,  score: 500, rank: 'elite' },
  ],
  police: [
    { id: 'officer',  name: 'Officer',       weapon: 'pistol',  health: 80,  armor: 10,  speed: 1.0,  skill: 0.42, score: 100, rank: 'grunt' },
    { id: 'riot',     name: 'Riot Officer',  weapon: 'smg',     health: 100, armor: 30,  speed: 0.98, skill: 0.52, score: 150, rank: 'grunt' },
    { id: 'rifleman', name: 'Rifleman',      weapon: 'rifle',   health: 110, armor: 40,  speed: 0.96, skill: 0.62, score: 220, rank: 'grunt' },
    { id: 'tactical', name: 'Tactical',      weapon: 'rifle',   health: 130, armor: 60,  speed: 1.02, skill: 0.75, score: 300, rank: 'elite' },
    { id: 'trooper',  name: 'Heavy Trooper', weapon: 'shotgun', health: 200, armor: 100, speed: 0.84, skill: 0.7,  score: 520, rank: 'elite' },
  ],
};
