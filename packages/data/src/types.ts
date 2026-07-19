// Typed, integer-only game data. All numbers are in SIM UNITS:
// distances in fixed-point sub-units (1024/cell), times in ticks (20/s).
// The integers.test.ts walker enforces integer-ness recursively.

export type FactionId = 'doorstate' | 'legion' | 'neutral';

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
  /** Attack range, sub-units. 0 = unarmed. */
  range: number;
  /** Ticks between attacks. */
  attackCooldown: number;
  /** Acquisition radius, sub-units. */
  acquire: number;
  /** Vision radius, cells. */
  vision: number;
  cost: { cash: number; vibe: number };
  /** Production time, ticks. */
  buildTime: number;
  /** Idle behavior: wanders near home (crowd units). */
  wanders: boolean;
}

export interface BuildingDef {
  /** Stable numeric id, disjoint from unit ids. */
  id: number;
  key: string;
  name: string;
  faction: FactionId;
  flavor: string;
  hp: number;
  /** Footprint in cells (square w×h). */
  w: number;
  h: number;
  vision: number;
  cost: { cash: number; vibe: number };
  /** Construction time, ticks (builder must be adjacent). */
  buildTime: number;
  /** Cash income per second (complete buildings). */
  cashPerSec: number;
  /** Vibe per second per dancer in radius (Dancefloors). */
  vibePerDancerSec: number;
  /** Dancer-counting radius, cells. */
  danceRadius: number;
  /** Heat generated per second of existence. */
  heatPerSec: number;
  /** Unit ids this building can train. */
  trains: number[];
}

export interface DoorPolicyDef {
  key: 'open' | 'selective' | 'locked';
  name: string;
  flavor: string;
  /** Percent multipliers (100 = ×1). */
  vibeIncomePct: number;
  heatPct: number;
}
