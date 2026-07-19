// Typed, integer-only game data. All numbers are in SIM UNITS:
// distances in fixed-point sub-units (1024/cell), times in ticks (20/s).
// The integers.test.ts walker enforces integer-ness recursively.

export type FactionId = 'doorstate' | 'legion' | 'neutral';

/** WC3-style damage/armor counter system. */
export type AttackType = 'normal' | 'pierce' | 'siege' | 'hero';
export type ArmorType = 'light' | 'medium' | 'heavy' | 'fortified';

export interface UnitDef {
  /** Stable numeric id — used in commands/snapshots. Never reuse. */
  id: number;
  key: string;
  name: string;
  faction: FactionId;
  flavor: string;
  hp: number;
  /** Sub-units per tick. */
  speed: number;
  damage: number;
  attackType: AttackType;
  armorType: ArmorType;
  /** Attack range, sub-units. 0 = unarmed. */
  range: number;
  /** Ticks between attacks. */
  attackCooldown: number;
  /** Acquisition radius, sub-units. */
  acquire: number;
  /** Vision radius, cells. */
  vision: number;
  cost: { cash: number; gear: number };
  /** Supply used. */
  headroom: number;
  /** Production time, ticks. */
  buildTime: number;
  /** Can gather from resource nodes. */
  isHarvester: boolean;
  /** Can construct buildings. */
  isBuilder: boolean;
  /** Idle behavior: wanders (ambient crowd units only). */
  wanders: boolean;
  /** Cash bounty when killed (creeps). */
  bounty: number;
  /** XP granted to killer's hero when killed. */
  xpValue: number;
  /** Minimum HQ tier required to train. */
  requiresTier: number;
}

export interface BuildingDef {
  /** Stable numeric id, disjoint from unit ids (100+). */
  id: number;
  key: string;
  name: string;
  faction: FactionId;
  flavor: string;
  hp: number;
  armorType: ArmorType;
  /** Turret damage (0 = doesn't fight). */
  damage: number;
  attackType: AttackType;
  range: number;
  attackCooldown: number;
  /** Footprint in cells (square w×h). */
  w: number;
  h: number;
  vision: number;
  cost: { cash: number; gear: number };
  /** Construction time, ticks (builder must be adjacent). */
  buildTime: number;
  /** Supply provided. */
  headroomProvided: number;
  /** Heat generated per second of existence. */
  heatPerSec: number;
  /** Unit ids this building can train. */
  trains: number[];
  /** Workers deliver resources here. */
  isDepot: boolean;
  /** HQ tier level this building counts as (0 = not an HQ). */
  tierLevel: number;
  /** Building id this can upgrade into (0 = none). */
  upgradesTo: number;
  /** Upgrade cost/time (used when upgradesTo != 0). */
  upgradeCost: { cash: number; gear: number };
  upgradeTime: number;
  /** Minimum HQ tier required to construct. */
  requiresTier: number;
}

/** Resource node defs (Queue = cash mine, Gear crate = tree). Ids 300+. */
export interface NodeDef {
  id: number;
  key: string;
  name: string;
  flavor: string;
  kind: 'cash' | 'gear';
  hp: number;
  w: number;
  h: number;
  /** Total resources contained. */
  reserve: number;
  /** Amount carried per trip. */
  carry: number;
  /** Ticks spent harvesting per trip. */
  harvestTime: number;
}

export type AbilityEffect = 'burst' | 'healPulse' | 'dash' | 'stun';

export interface AbilityDef {
  key: string;
  name: string;
  flavor: string;
  /** 0..3 → Q/W/E/R. */
  slot: number;
  effect: AbilityEffect;
  /** Hero level required (R is the lvl-6 ultimate). */
  unlockLevel: number;
  cooldown: number;
  hypeCost: number;
  /** Cast range, sub-units (0 = self-centered). */
  range: number;
  /** Effect radius, sub-units. */
  radius: number;
  /** Damage (burst/stun) or heal (healPulse) amount. */
  amount: number;
  /** Stun duration, ticks (stun effect). */
  stunTicks: number;
}

export interface HeroDef {
  /** The unit def this hero is based on (hero unit ids 32+). */
  unitId: number;
  key: string;
  name: string;
  title: string;
  /** Per-level growth. */
  hpPerLevel: number;
  damagePerLevel: number;
  /** XP needed per level = xpBase * level. */
  xpBase: number;
  maxLevel: number;
  hypeMax: number;
  /** Hype regen per tick (scaled by 100: 5 = 0.05/tick). */
  hypeRegenPer100: number;
  abilities: AbilityDef[];
  /** Revive cost = base + perLevel * level. */
  reviveBase: number;
  revivePerLevel: number;
}

export interface DoorPolicyDef {
  key: 'open' | 'selective' | 'locked';
  name: string;
  flavor: string;
  /** Percent multipliers (100 = ×1). */
  vibeIncomePct: number;
  heatPct: number;
}
