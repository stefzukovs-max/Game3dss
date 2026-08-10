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
 * All names, units and crews are invented for this game.
 */

export const FACTIONS = {
  gang: {
    id: 'gang',
    name: 'Comando do Morro',
    short: 'MORRO',
    blurb: 'They grew up on these stairs. Improvised gear, total map knowledge, nothing to lose.',
    color: 0xffd23f,
    css: '#ffd23f',
    accent: '#ff7a2f',
  },
  police: {
    id: 'police',
    name: 'Batalhão Tático',
    short: 'TÁTICO',
    blurb: 'Issued armour, issued rifles, no idea which alley opens onto which roof.',
    color: 0x4ea3ff,
    css: '#4ea3ff',
    accent: '#1e5fb8',
  },
};

/**
 * stats
 *   health / armor : armour absorbs 65% of incoming damage until it's gone
 *   speed          : multiplier on the 4.6 m/s base jog
 *   control        : recoil recovery + bloom decay multiplier
 */
export const ROSTER = [
  /* ══════════════ COMANDO DO MORRO ══════════════ */
  {
    id: 'pipa', faction: 'gang', name: 'Pipa', role: 'Olheiro', roleEn: 'Recon',
    tag: 'THE LOOKOUT',
    bio: 'Fifteen years old and the fastest thing on the hill. Flies a kite off the water tanks — one colour means a patrol, two means a raid. Has never once been caught on the stairs.',
    quote: '“Se a pipa subir, corre.”',
    quoteEn: 'If the kite goes up, run.',
    stats: { health: 85, armor: 0, speed: 1.18, control: 1.0 },
    loadout: ['smg', 'pistol'],
    grenades: 2,
    build: { frame: 'light', headgear: 'cap', extra: 'kite' },
    passive: {
      name: 'Telhado', nameEn: 'Rooftops',
      desc: '+40% jump height, no fall damage from short drops, and your footsteps are near-silent.',
      icon: '🏃',
    },
    ability: {
      id: 'reveal', name: 'Linha de Pipa', nameEn: 'Kite Line', cooldown: 24, duration: 7,
      desc: 'Send the kite up. Every hostile is outlined through walls for 7 seconds — for you and your crew.',
      icon: '🪁', radius: 999,
    },
    diff: 2,
  },
  {
    id: 'bagre', faction: 'gang', name: 'Bagre', role: 'Segurança', roleEn: 'Heavy',
    tag: 'THE DOOR',
    bio: 'Stands at the mouth of the alley so nobody else has to. Carries a shortened pump gun and a sheet of road sign he calls a shield.',
    quote: '“Passa por cima, então.”',
    quoteEn: 'Go through me, then.',
    stats: { health: 150, armor: 60, speed: 0.86, control: 0.9 },
    loadout: ['shotgun', 'pistol'],
    grenades: 1,
    build: { frame: 'heavy', headgear: 'bandana', extra: 'plate' },
    passive: {
      name: 'Couro Grosso', nameEn: 'Thick Hide',
      desc: 'Take 25% less damage and never get staggered by incoming fire.',
      icon: '🛡',
    },
    ability: {
      id: 'barricade', name: 'Barricada', nameEn: 'Barricade', cooldown: 26, duration: 16,
      desc: 'Drop a scrap-metal barricade where you stand. Solid cover for you and the crew.',
      icon: '🚧',
    },
    diff: 1,
  },
  {
    id: 'rainha', faction: 'gang', name: 'Rainha', role: 'Atiradora', roleEn: 'Marksman',
    tag: 'THE PATIENCE',
    bio: 'Sits cross-legged on the highest water tank for hours. Calm to the point of unnerving. The hill goes quiet when she starts working.',
    quote: '“Um de cada vez.”',
    quoteEn: 'One at a time.',
    stats: { health: 100, armor: 20, speed: 1.0, control: 1.35 },
    loadout: ['rifle', 'pistol'],
    grenades: 1,
    build: { frame: 'normal', headgear: 'bandana', extra: 'sling' },
    passive: {
      name: 'Respiração', nameEn: 'Breath Control',
      desc: 'Aiming while crouched removes bullet bloom completely. +30% headshot damage.',
      icon: '🎯',
    },
    ability: {
      id: 'focus', name: 'Olho de Águia', nameEn: "Eagle's Eye", cooldown: 22, duration: 7,
      desc: 'Zoom in hard. Perfect accuracy, +35% damage, and time seems to slow while you hold your breath.',
      icon: '👁', radius: 0,
    },
    diff: 3,
  },
  {
    id: 'fumaca', faction: 'gang', name: 'Fumaça', role: 'Artificeiro', roleEn: 'Disruptor',
    tag: 'THE FIREWORKS',
    bio: 'Used to run the June festival fireworks. Same skill set, different季 season. Everything he throws makes the police stop moving forward.',
    quote: '“Festa junina o ano todo.”',
    quoteEn: 'Festival season all year round.',
    stats: { health: 100, armor: 10, speed: 1.06, control: 1.0 },
    loadout: ['smg', 'pistol'],
    grenades: 4,
    build: { frame: 'normal', headgear: 'cap', extra: 'bandolier' },
    passive: {
      name: 'Pirotecnia', nameEn: 'Pyrotechnics',
      desc: 'Carry double throwables and deal +35% explosive damage. Grenades cook faster.',
      icon: '💥',
    },
    ability: {
      id: 'molotov', name: 'Coquetel', nameEn: 'Molotov', cooldown: 15, duration: 9,
      desc: 'Throw a bottle that leaves a pool of fire. Nothing crosses it without burning.',
      icon: '🔥',
    },
    diff: 2,
  },
  {
    id: 'doutor', faction: 'gang', name: 'Doutor', role: 'Enfermeiro', roleEn: 'Support',
    tag: 'THE STITCHES',
    bio: 'Two years of medical school and a back room full of supplies. Half the hill owes him a scar that healed clean. Fights only when he has to — but he has to a lot.',
    quote: '“Senta aí. Isso vai arder.”',
    quoteEn: 'Sit down. This is going to sting.',
    stats: { health: 110, armor: 20, speed: 1.0, control: 1.1 },
    loadout: ['smg', 'pistol'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'none', extra: 'medbag' },
    passive: {
      name: 'Mão Boa', nameEn: 'Steady Hands',
      desc: 'Regenerate health three times faster out of combat, and start regenerating twice as soon.',
      icon: '✚',
    },
    ability: {
      id: 'medkit', name: 'Kit', nameEn: 'Field Kit', cooldown: 20, duration: 14,
      desc: 'Drop a supply kit. Heals and re-arms you and any crew standing near it.',
      icon: '🧰',
    },
    diff: 1,
  },

  /* ══════════════ BATALHÃO TÁTICO ══════════════ */
  {
    id: 'duarte', faction: 'police', name: 'Cap. Duarte', role: 'Comandante', roleEn: 'Assault',
    tag: 'THE ORDER',
    bio: 'Twenty-two years in, and still first up the stairs. Believes the operation ends when everyone comes back down, which is not the same thing his superiors believe.',
    quote: '“Comigo. Em coluna.”',
    quoteEn: 'On me. Single file.',
    stats: { health: 115, armor: 40, speed: 1.0, control: 1.15 },
    loadout: ['rifle', 'pistol'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'helmet', extra: 'radio' },
    passive: {
      name: 'Comando', nameEn: 'Command',
      desc: 'Squadmates within 18 m deal +15% damage. You reload 20% faster.',
      icon: '📻',
    },
    ability: {
      id: 'surge', name: 'Avançar', nameEn: 'Push Up', cooldown: 22, duration: 7,
      desc: 'Call the push. You and every nearby squadmate get +25% movement and fire rate.',
      icon: '⬆', radius: 20,
    },
    diff: 1,
  },
  {
    id: 'muralha', faction: 'police', name: 'Sgt. Muralha', role: 'Escudo', roleEn: 'Heavy',
    tag: 'THE WALL',
    bio: 'Carries the ballistic shield up eleven flights of stairs without complaining, then complains for an hour afterwards. Nothing gets past the doorway he is standing in.',
    quote: '“Atrás de mim. Todo mundo.”',
    quoteEn: 'Behind me. Everyone.',
    stats: { health: 160, armor: 80, speed: 0.82, control: 0.88 },
    loadout: ['shotgun', 'pistol'],
    grenades: 1,
    build: { frame: 'heavy', headgear: 'helmet', extra: 'shield' },
    passive: {
      name: 'Blindado', nameEn: 'Hardened',
      desc: 'Take 30% less damage from the front. Immune to stagger and flashes.',
      icon: '🛡',
    },
    ability: {
      id: 'barricade', name: 'Escudo Móvel', nameEn: 'Deployable Shield', cooldown: 24, duration: 14,
      desc: 'Plant the ballistic shield. Hard cover in the open, right where the squad needs it.',
      icon: '🚧',
    },
    diff: 1,
  },
  {
    id: 'lira', faction: 'police', name: 'Cb. Lira', role: 'Precisão', roleEn: 'Marksman',
    tag: 'THE ANGLE',
    bio: 'Finds the one window in the plaza that sees three sets of stairs at once, and then does not move for the rest of the operation.',
    quote: '“Tenho ângulo. Podem subir.”',
    quoteEn: 'I have the angle. Go ahead and climb.',
    stats: { health: 90, armor: 20, speed: 1.02, control: 1.4 },
    loadout: ['rifle', 'pistol'],
    grenades: 1,
    build: { frame: 'light', headgear: 'cap', extra: 'scope' },
    passive: {
      name: 'Frieza', nameEn: 'Cold Blood',
      desc: 'Aimed shots taken while standing perfectly still deal +45% damage.',
      icon: '❄',
    },
    ability: {
      id: 'thermal', name: 'Mira Térmica', nameEn: 'Thermal Optic', cooldown: 21, duration: 8,
      desc: 'Switch to thermal. Hostiles glow through walls while you are aiming down sights.',
      icon: '🌡', radius: 999,
    },
    diff: 3,
  },
  {
    id: 'sayuri', faction: 'police', name: 'Ten. Sayuri', role: 'Invasão', roleEn: 'Breacher',
    tag: 'THE DOORWAY',
    bio: 'Goes through the door first because she has decided, permanently and without discussion, that nobody else is going to.',
    quote: '“Porta. Flash. Entra.”',
    quoteEn: 'Door. Flash. In.',
    stats: { health: 105, armor: 40, speed: 1.07, control: 1.05 },
    loadout: ['shotgun', 'smg'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'helmet', extra: 'breach' },
    passive: {
      name: 'Porta Abaixo', nameEn: 'Door Down',
      desc: '+35% damage inside 8 m and you bring the sights up 40% faster.',
      icon: '🚪',
    },
    ability: {
      id: 'flash', name: 'Flash', nameEn: 'Flashbang', cooldown: 14, duration: 4,
      desc: 'Throw a flashbang. Anyone looking at it is blind and useless for four seconds.',
      icon: '⚡',
    },
    diff: 2,
  },
  {
    id: 'camargo', faction: 'police', name: 'Sd. Camargo', role: 'Apoio', roleEn: 'Support',
    tag: 'THE EYES',
    bio: 'Runs the drone, carries the ammo, keeps the radio charged. Newest on the team and the only one who has read the whole manual.',
    quote: '“Drone no ar. Contagem: seis.”',
    quoteEn: 'Drone up. Count: six.',
    stats: { health: 100, armor: 30, speed: 1.0, control: 1.1 },
    loadout: ['smg', 'pistol'],
    grenades: 2,
    build: { frame: 'normal', headgear: 'cap', extra: 'drone' },
    passive: {
      name: 'Logística', nameEn: 'Logistics',
      desc: '+60% reserve ammo, and you vacuum up ammo pickups from 6 m away.',
      icon: '🎒',
    },
    ability: {
      id: 'drone', name: 'Drone', nameEn: 'Recon Drone', cooldown: 19, duration: 9,
      desc: 'Put the drone up. Marks every hostile on the minimap and outlines the close ones.',
      icon: '🛸', radius: 999,
    },
    diff: 1,
  },
];

export const byId = (id) => ROSTER.find((c) => c.id === id);
export const rosterFor = (faction) => ROSTER.filter((c) => c.faction === faction);

/** Grunt archetypes the AI spawns as, tuned per wave difficulty. */
export const GRUNTS = {
  gang: [
    { id: 'soldado', name: 'Soldado', weapon: 'smg', health: 80, armor: 0, speed: 1.05, skill: 0.45, score: 100, rank: 'grunt' },
    { id: 'fogueteiro', name: 'Fogueteiro', weapon: 'pistol', health: 65, armor: 0, speed: 1.2, skill: 0.35, score: 80, rank: 'grunt' },
    { id: 'vapor', name: 'Vapor', weapon: 'shotgun', health: 110, armor: 20, speed: 0.95, skill: 0.5, score: 150, rank: 'grunt' },
    { id: 'gerente', name: 'Gerente', weapon: 'rifle', health: 120, armor: 40, speed: 1.0, skill: 0.68, score: 240, rank: 'elite' },
    { id: 'frente', name: 'Frente de Guerra', weapon: 'rifle', health: 180, armor: 80, speed: 0.92, skill: 0.8, score: 500, rank: 'elite' },
  ],
  police: [
    { id: 'praca', name: 'Policial', weapon: 'pistol', health: 80, armor: 10, speed: 1.0, skill: 0.42, score: 100, rank: 'grunt' },
    { id: 'choque', name: 'Choque', weapon: 'smg', health: 100, armor: 30, speed: 0.98, skill: 0.52, score: 150, rank: 'grunt' },
    { id: 'fuzileiro', name: 'Fuzileiro', weapon: 'rifle', health: 110, armor: 40, speed: 0.96, skill: 0.62, score: 220, rank: 'grunt' },
    { id: 'tatico', name: 'Tático', weapon: 'rifle', health: 130, armor: 60, speed: 1.02, skill: 0.75, score: 300, rank: 'elite' },
    { id: 'blindado', name: 'Blindado', weapon: 'shotgun', health: 200, armor: 100, speed: 0.84, skill: 0.7, score: 520, rank: 'elite' },
  ],
};
