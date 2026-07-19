import {
  addComponent,
  addEntity,
  createWorld,
  hasComponent,
  removeComponent,
  type World,
} from 'bitecs';
import { BUILDINGS_BY_ID, UNITS, UNITS_BY_ID, type BuildingDef, type UnitDef } from '@wotc/data';
import { FP, idiv } from './fp.ts';
import { blockRect, type WalkGrid } from './map/grid.ts';
import { buildMap, type MapId } from './map/maps.ts';
import { FlowFieldCache } from './path/flowfield.ts';
import { createPrng, type Prng } from './prng.ts';

// ── Capacity & entity id policy ─────────────────────────────────────────────
// Entity ids are MONOTONIC: we never call bitecs removeEntity, so ids are a
// pure function of the allocation count and are never recycled. "Death" is
// stripping all components (a memberless entity matches no query). This makes
// snapshot/restore exact using only public bitecs API, at the cost of a hard
// cap on total entities ever created in one match. 32k is plenty for v1.
export const CAPACITY = 32768;

/** Production queue slots per building. */
export const QUEUE_SLOTS = 5;

/** Number of players (fog grids, resources). */
export const MAX_PLAYERS = 2;

// ── Components ──────────────────────────────────────────────────────────────
// bitecs 0.4 components are plain objects with user-owned storage. Each sim
// gets its OWN arrays (createComponents per sim) — no cross-sim state, which
// lets a live game and a restored replay coexist in one process.

const i32 = () => new Int32Array(CAPACITY);
const ui8 = () => new Uint8Array(CAPACITY);
const ui16 = () => new Uint16Array(CAPACITY);

export function createComponents() {
  return {
    Position: { x: i32(), y: i32() },
    Velocity: { x: i32(), y: i32() },
    Owner: { player: ui8() },
    Kind: { id: ui16(), speed: i32() },
    MoveTarget: {
      x: i32(),
      y: i32(),
      active: ui8(),
      stuck: i32(),
      /** Final destination (x/y may temporarily chase an enemy). */
      destX: i32(),
      destY: i32(),
      /** Attack-move: engage enemies encountered on the way. */
      amove: ui8(),
    },
    Health: { hp: i32(), max: i32() },
    Combat: {
      damage: i32(),
      /** Attack range, sub-units. */
      range: i32(),
      /** Ticks between attacks. */
      cooldown: i32(),
      cdLeft: i32(),
      /** Acquisition radius, sub-units. */
      acquire: i32(),
    },
    Building: {
      kindId: ui16(),
      /** Footprint origin cell + size (needed to unblock on death). */
      cellX: ui16(),
      cellY: ui16(),
      w: ui8(),
      h: ui8(),
      /** Construction progress in ticks; complete when >= def.buildTime. */
      progress: i32(),
      complete: ui8(),
      rallyX: i32(),
      rallyY: i32(),
      /** Production: unit id in progress (-1 = idle) + remaining ticks. */
      prodKind: i32(),
      prodLeft: i32(),
      qLen: ui8(),
      q0: ui16(),
      q1: ui16(),
      q2: ui16(),
      q3: ui16(),
      q4: ui16(),
    },
    /** Idle-wander behavior (crowd units — Clubgoers dancing about). */
    Walker: { cooldown: i32() },
  };
}

export type Components = ReturnType<typeof createComponents>;
export type ComponentName = keyof Components;

/**
 * FIXED component order for checksums and snapshots. Changing this order (or
 * any schema) is a sim-version break: bump SNAPSHOT_VERSION and old
 * replays/saves stop validating.
 */
export const COMPONENT_NAMES = [
  'Position',
  'Velocity',
  'Owner',
  'Kind',
  'MoveTarget',
  'Health',
  'Combat',
  'Building',
  'Walker',
] as const satisfies readonly ComponentName[];

export type IntArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

/**
 * A component's field arrays as [name, array] pairs sorted by field name —
 * the canonical order used by both checksums and snapshots.
 */
export function componentFields(component: object): Array<[string, IntArray]> {
  return Object.entries(component)
    .filter(([, v]) => ArrayBuffer.isView(v))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) as Array<[string, IntArray]>;
}

// ── World ───────────────────────────────────────────────────────────────────

export interface SimWorld {
  world: World;
  c: Components;
  tick: number;
  prng: Prng;
  /** Total entities ever allocated (monotonic — never decreases). */
  allocated: number;
  mapId: MapId;
  /**
   * Walkability: base map from mapId + building footprints. Mutated ONLY by
   * placeFootprint/clearFootprint, which also invalidate the flow cache.
   * Reconstructable (map + alive buildings), so not snapshotted directly.
   */
  grid: WalkGrid;
  /**
   * Fog of war, one grid per player: 0 unexplored, 1 explored, 2 visible.
   * Accumulates over time, so it IS state (checksummed + snapshotted).
   */
  fog: Uint8Array[];
  /** Per-player resources & state (checksummed + snapshotted). */
  cash: Int32Array;
  vibe: Int32Array;
  heat: Int32Array;
  /** Door policy per player: 0 open, 1 selective, 2 locked. */
  policy: Uint8Array;
  /** Raids already triggered against player 0. */
  raidsSpawned: number;
  /** Derived cache — deterministic function of (grid, target), never state. */
  flowCache: FlowFieldCache;
  /** Map size in fixed-point sub-units. */
  mapW: number;
  mapH: number;
}

export interface SimOptions {
  mapId?: MapId;
}

export function createSim(seed: number, opts: SimOptions = {}): SimWorld {
  const mapId = opts.mapId ?? 'empty256';
  const grid = buildMap(mapId);
  const policy = new Uint8Array(MAX_PLAYERS);
  policy.fill(1); // selective
  return {
    world: createWorld(),
    c: createComponents(),
    tick: 0,
    prng: createPrng(seed),
    allocated: 0,
    mapId,
    grid,
    fog: Array.from({ length: MAX_PLAYERS }, () => new Uint8Array(grid.w * grid.h)),
    cash: new Int32Array(MAX_PLAYERS),
    vibe: new Int32Array(MAX_PLAYERS),
    heat: new Int32Array(MAX_PLAYERS),
    policy,
    raidsSpawned: 0,
    flowCache: new FlowFieldCache(grid),
    mapW: grid.w * FP,
    mapH: grid.h * FP,
  };
}

export { buildMap, mapIndex, MAP_IDS } from './map/maps.ts';
export type { MapId } from './map/maps.ts';

/**
 * Allocate an entity. Ids are sequential and never reused.
 * bitecs reserves eid 0 as the null entity, so live ids are 1..allocated.
 */
export function spawnEntity(sim: SimWorld): number {
  if (sim.allocated + 1 >= CAPACITY) throw new Error('entity capacity exhausted');
  const eid = addEntity(sim.world);
  if (eid !== sim.allocated + 1) {
    throw new Error(
      `entity id ${eid} != expected ${sim.allocated + 1} — monotonic id invariant broken`,
    );
  }
  sim.allocated++;
  return eid;
}

/** "Kill" an entity: strip all components. The id is retired forever.
 * Buildings also release their footprint. */
export function killEntity(sim: SimWorld, eid: number): void {
  const { Building } = sim.c;
  if (hasComponent(sim.world, eid, Building)) {
    clearFootprint(sim, Building.cellX[eid]!, Building.cellY[eid]!, Building.w[eid]!, Building.h[eid]!);
  }
  for (const name of COMPONENT_NAMES) {
    const comp = sim.c[name];
    if (hasComponent(sim.world, eid, comp)) removeComponent(sim.world, eid, comp);
  }
}

/** Alive = allocated and still physically present (has Position). */
export function isAlive(sim: SimWorld, eid: number): boolean {
  return eid >= 1 && eid <= sim.allocated && hasComponent(sim.world, eid, sim.c.Position);
}

/**
 * DETERMINISM RULE: systems must iterate entities in ascending-eid order.
 * bitecs query order reflects component-add order, which snapshot restore
 * does not reproduce — so every system sorts. Cheap at v1 scale.
 */
export function sortedAsc(ents: ArrayLike<number>): number[] {
  return Array.from(ents).sort((a, b) => a - b);
}

// ── Data lookups ────────────────────────────────────────────────────────────

/** Compat aliases for early milestones' demo kinds. */
export const KIND_WALKER = UNITS.clubgoer.id;
export const KIND_UNIT = UNITS.bouncer.id;
export const KIND_RANGED = UNITS.strobe_acolyte.id;

export function unitDef(kind: number): UnitDef {
  const def = UNITS_BY_ID.get(kind);
  if (!def) throw new Error(`unknown unit kind ${kind}`);
  return def;
}

export function buildingDef(kind: number): BuildingDef {
  const def = BUILDINGS_BY_ID.get(kind);
  if (!def) throw new Error(`unknown building kind ${kind}`);
  return def;
}

// ── Spawning ────────────────────────────────────────────────────────────────

/** Spawn a unit with stats from @wotc/data. Wanderers get Walker behavior. */
export function spawnUnit(
  sim: SimWorld,
  player: number,
  kind: number,
  x: number,
  y: number,
): number {
  const def = unitDef(kind);
  const eid = spawnEntity(sim);
  const { Position, Velocity, Owner, Kind, MoveTarget, Health, Combat, Walker } = sim.c;
  addComponent(sim.world, eid, Position);
  addComponent(sim.world, eid, Velocity);
  addComponent(sim.world, eid, Owner);
  addComponent(sim.world, eid, Kind);
  addComponent(sim.world, eid, MoveTarget);
  addComponent(sim.world, eid, Health);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Owner.player[eid] = player % MAX_PLAYERS;
  Kind.id[eid] = kind;
  Kind.speed[eid] = def.speed;
  MoveTarget.active[eid] = 0;
  MoveTarget.amove[eid] = 0;
  Health.hp[eid] = def.hp;
  Health.max[eid] = def.hp;
  if (def.damage > 0) {
    addComponent(sim.world, eid, Combat);
    Combat.damage[eid] = def.damage;
    Combat.range[eid] = def.range;
    Combat.cooldown[eid] = def.attackCooldown;
    Combat.cdLeft[eid] = 0;
    Combat.acquire[eid] = def.acquire;
  }
  if (def.wanders) {
    addComponent(sim.world, eid, Walker);
    Walker.cooldown[eid] = 0;
  }
  return eid;
}

function stampFootprint(sim: SimWorld, cellX: number, cellY: number, w: number, h: number): void {
  blockRect(sim.grid, cellX, cellY, w, h);
  sim.flowCache.clear();
}

function clearFootprint(sim: SimWorld, cellX: number, cellY: number, w: number, h: number): void {
  // Buildings only ever occupy previously-walkable cells, so clearing the
  // rect restores the base map exactly.
  for (let y = cellY; y < cellY + h; y++) {
    for (let x = cellX; x < cellX + w; x++) {
      sim.grid.cells[x + y * sim.grid.w] = 0;
    }
  }
  sim.flowCache.clear();
}

/** Can a building footprint go here? (all cells walkable & in bounds) */
export function canPlaceBuilding(sim: SimWorld, kind: number, cellX: number, cellY: number): boolean {
  const def = buildingDef(kind);
  if (cellX < 0 || cellY < 0 || cellX + def.w > sim.grid.w || cellY + def.h > sim.grid.h) {
    return false;
  }
  for (let y = cellY; y < cellY + def.h; y++) {
    for (let x = cellX; x < cellX + def.w; x++) {
      if (sim.grid.cells[x + y * sim.grid.w] !== 0) return false;
    }
  }
  return true;
}

/** Spawn a building at a footprint origin cell. */
export function spawnBuilding(
  sim: SimWorld,
  player: number,
  kind: number,
  cellX: number,
  cellY: number,
  complete: boolean,
): number {
  const def = buildingDef(kind);
  const eid = spawnEntity(sim);
  const { Position, Owner, Health, Building } = sim.c;
  addComponent(sim.world, eid, Position);
  addComponent(sim.world, eid, Owner);
  addComponent(sim.world, eid, Health);
  addComponent(sim.world, eid, Building);
  // Center of the footprint, in sub-units.
  Position.x[eid] = cellX * FP + idiv(def.w * FP, 2);
  Position.y[eid] = cellY * FP + idiv(def.h * FP, 2);
  Owner.player[eid] = player % MAX_PLAYERS;
  Health.hp[eid] = def.hp;
  Health.max[eid] = def.hp;
  Building.kindId[eid] = kind;
  Building.cellX[eid] = cellX;
  Building.cellY[eid] = cellY;
  Building.w[eid] = def.w;
  Building.h[eid] = def.h;
  Building.progress[eid] = complete ? def.buildTime : 0;
  Building.complete[eid] = complete ? 1 : 0;
  // Default rally: one cell below the footprint.
  Building.rallyX[eid] = Position.x[eid]!;
  Building.rallyY[eid] = (cellY + def.h + 1) * FP;
  Building.prodKind[eid] = -1;
  Building.prodLeft[eid] = 0;
  Building.qLen[eid] = 0;
  stampFootprint(sim, cellX, cellY, def.w, def.h);
  return eid;
}

/** Restamp all alive building footprints (snapshot restore). */
export function restampFootprints(sim: SimWorld): void {
  const { Building } = sim.c;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid) || !hasComponent(sim.world, eid, Building)) continue;
    blockRect(sim.grid, Building.cellX[eid]!, Building.cellY[eid]!, Building.w[eid]!, Building.h[eid]!);
  }
  sim.flowCache.clear();
}

export { hasComponent };
