import {
  addComponent,
  addEntity,
  createWorld,
  hasComponent,
  removeComponent,
  type World,
} from 'bitecs';
import { FP } from './fp.ts';
import { createPrng, type Prng } from './prng.ts';

// ── Capacity & entity id policy ─────────────────────────────────────────────
// Entity ids are MONOTONIC: we never call bitecs removeEntity, so ids are a
// pure function of the allocation count and are never recycled. "Death" is
// stripping all components (a memberless entity matches no query). This makes
// snapshot/restore exact using only public bitecs API, at the cost of a hard
// cap on total entities ever created in one match. 32k is plenty for v1.
export const CAPACITY = 32768;

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
    Kind: { id: ui16() },
    MoveTarget: { x: i32(), y: i32(), active: ui8() },
    /** Debug/demo behavior: wander randomly when idle (M1/M2 scaffolding). */
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
  /** Map size in fixed-point sub-units. */
  mapW: number;
  mapH: number;
}

export interface SimOptions {
  /** Map size in cells (default 256×256). */
  mapCells?: number;
}

export function createSim(seed: number, opts: SimOptions = {}): SimWorld {
  const cells = opts.mapCells ?? 256;
  return {
    world: createWorld(),
    c: createComponents(),
    tick: 0,
    prng: createPrng(seed),
    allocated: 0,
    mapW: cells * FP,
    mapH: cells * FP,
  };
}

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

/** "Kill" an entity: strip all components. The id is retired forever. */
export function killEntity(sim: SimWorld, eid: number): void {
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

/** Unit kinds (placeholder until @wotc/data unit defs land in M7). */
export const KIND_WALKER = 0; // wanders when idle (demo/bench crowds)
export const KIND_UNIT = 1; // obeys orders, stands still when idle

/** Spawn a unit. Kind 0 gets the idle-wander Walker behavior. */
export function spawnUnit(
  sim: SimWorld,
  player: number,
  kind: number,
  x: number,
  y: number,
): number {
  const eid = spawnEntity(sim);
  const { Position, Velocity, Owner, Kind, MoveTarget, Walker } = sim.c;
  addComponent(sim.world, eid, Position);
  addComponent(sim.world, eid, Velocity);
  addComponent(sim.world, eid, Owner);
  addComponent(sim.world, eid, Kind);
  addComponent(sim.world, eid, MoveTarget);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Owner.player[eid] = player;
  Kind.id[eid] = kind;
  MoveTarget.active[eid] = 0;
  if (kind === KIND_WALKER) {
    addComponent(sim.world, eid, Walker);
    Walker.cooldown[eid] = 0;
  }
  return eid;
}

export { hasComponent };
