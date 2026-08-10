/**
 * Between-wave draft: three cards, pick one. Cards stack, so a long run turns
 * your operator into a specific build rather than just a bigger healthbar.
 */

export const CARDS = [
  {
    id: 'calibre', name: 'Calibre', nameEn: 'Heavier Rounds', icon: '🔩', rarity: 'common',
    desc: '+14% weapon damage.',
    apply: (p) => { p.upgrades.damage *= 1.14; },
  },
  {
    id: 'couro', name: 'Couro', nameEn: 'Thicker Skin', icon: '❤', rarity: 'common',
    desc: '+25% maximum health, and heal to full right now.',
    apply: (p) => { p.upgrades.health *= 1.25; p.health = p.maxHealth * p.upgrades.health; },
  },
  {
    id: 'adrenalina', name: 'Adrenalina', nameEn: 'Adrenaline', icon: '🏃', rarity: 'common',
    desc: '+9% movement speed.',
    apply: (p) => { p.upgrades.speed *= 1.09; },
  },
  {
    id: 'maos', name: 'Mãos Rápidas', nameEn: 'Fast Hands', icon: '🤲', rarity: 'common',
    desc: '+22% reload speed and faster recoil recovery.',
    apply: (p) => { p.upgrades.reload *= 1.22; },
  },
  {
    id: 'bornal', name: 'Bornal', nameEn: 'Deep Pockets', icon: '🎒', rarity: 'common',
    desc: '+35% reserve ammo capacity, and top up now.',
    apply: (p) => {
      p.upgrades.ammo *= 1.35;
      for (const w of Object.values(p.weapons)) {
        w.def = { ...w.def, maxReserve: Math.round(w.def.maxReserve * 1.35) };
        w.addAmmo(Math.round(w.def.mag * 3));
      }
    },
  },
  {
    id: 'colete', name: 'Colete', nameEn: 'Plate Carrier', icon: '🛡', rarity: 'uncommon',
    desc: '+30 armour capacity and armour slowly regenerates.',
    apply: (p) => { p.maxArmor = (p.maxArmor || 0) + 30; p.armor = p.maxArmor; p.upgrades.armorRegen += 1.6; },
  },
  {
    id: 'foco', name: 'Foco', nameEn: 'Focus', icon: '⚡', rarity: 'uncommon',
    desc: '−18% ability cooldown.',
    apply: (p) => { p.upgrades.cooldown *= 1.22; },
  },
  {
    id: 'sangue', name: 'Sanguessuga', nameEn: 'Leech', icon: '🩸', rarity: 'uncommon',
    desc: 'Heal for 7% of the damage you deal.',
    apply: (p) => { p.upgrades.lifesteal += 0.07; },
  },
  {
    id: 'estilingue', name: 'Estilingue', nameEn: 'Bandolier', icon: '💣', rarity: 'uncommon',
    desc: '+2 grenade capacity, refilled now.',
    apply: (p) => { p.maxGrenades += 2; p.grenades = p.maxGrenades; },
  },
  {
    id: 'precisao', name: 'Precisão', nameEn: 'Precision', icon: '🎯', rarity: 'uncommon',
    desc: '+30% headshot damage and 20% tighter hipfire.',
    apply: (p) => {
      p.upgrades.headshot = (p.upgrades.headshot || 1) * 1.3;
      for (const w of Object.values(p.weapons)) {
        w.def = { ...w.def, spreadHip: w.def.spreadHip * 0.8, headMul: w.def.headMul * 1.3 };
      }
    },
  },
  {
    id: 'segunda', name: 'Segunda Chance', nameEn: 'Second Wind', icon: '✨', rarity: 'rare',
    desc: 'Once per wave, survive a killing blow at 1 HP and get a moment of speed.',
    apply: (p) => { p.upgrades.secondWind = (p.upgrades.secondWind || 0) + 1; p.secondWindLeft = p.upgrades.secondWind; },
  },
  {
    id: 'rajada', name: 'Rajada', nameEn: 'Full Auto', icon: '🔥', rarity: 'rare',
    desc: '+15% fire rate on every weapon.',
    apply: (p) => {
      for (const w of Object.values(p.weapons)) w.def = { ...w.def, rpm: w.def.rpm * 1.15 };
    },
  },
  {
    id: 'reserva', name: 'Reserva', nameEn: 'Reserve Crew', icon: '👥', rarity: 'rare',
    desc: 'One extra ally fights alongside you from now on.',
    apply: (p) => { p.game.waves.alliesWanted = Math.min(6, p.game.waves.alliesWanted + 1); },
  },
];

/** Draw `n` distinct cards, weighted so rares stay special. */
export function drawCards(n = 3, wave = 1) {
  const weight = (c) =>
    c.rarity === 'common' ? 10 :
    c.rarity === 'uncommon' ? 5 + wave * 0.35 :
    1 + wave * 0.45;

  const pool = CARDS.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, c) => s + weight(c), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= weight(pool[i]);
      if (r <= 0) { idx = i; break; }
    }
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
