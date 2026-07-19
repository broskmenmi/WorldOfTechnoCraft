import { query } from 'bitecs';
import type { Command } from './commands.ts';
import { clamp, dist, FP, fpCos, fpSin, idiv, TURN } from './fp.ts';
import { fnv1aArray, fnv1aI32, FNV_OFFSET } from './hash.ts';
import { isWalkable, losClear, nearestWalkable, toCell } from './map/grid.ts';
import { SpatialHash } from './path/steering.ts';
import { nextInt } from './prng.ts';
import {
  COMPONENT_NAMES,
  componentFields,
  hasComponent,
  isAlive,
  KIND_STATS,
  KIND_WALKER,
  killEntity,
  mapIndex,
  MAX_PLAYERS,
  sortedAsc,
  spawnUnit,
  type SimWorld,
} from './world.ts';

/** Sim tick rate — 20 Hz. */
export const TICK_RATE = 20;
/** Checksum cadence in ticks. */
export const CHECKSUM_INTERVAL = 10;

/** Demo unit speed: 4 cells/second at 20 ticks/second. */
const WALK_SPEED = idiv(4 * FP, TICK_RATE);
/** Distance at which a move target counts as reached. */
const ARRIVE_EPSILON = idiv(FP, 2);
/** cos(45°) scaled by FP — diagonal speed normalization. */
const DIAG = 724;
/** Give up after this many ticks without progress ("the crowd has decided"). */
const STUCK_LIMIT = 40;
const STUCK_EPSILON = idiv(FP, 64);
/** Within this range, check line-of-sight and steer directly when clear. */
const LOS_RANGE = 32 * FP;
/** Blocked but short: steer directly anyway (wall-slide + stuck sort it out).
 * Flow-field BFS is reserved for genuinely long blocked routes. */
const DIRECT_RANGE = 12 * FP;

/** Snap a sub-unit position to the center of the nearest walkable cell. */
function snapWalkable(sim: SimWorld, x: number, y: number): [number, number] {
  const cx = toCell(clamp(x, 0, sim.mapW - 1));
  const cy = toCell(clamp(y, 0, sim.mapH - 1));
  if (isWalkable(sim.grid, cx, cy)) return [clamp(x, 0, sim.mapW - 1), clamp(y, 0, sim.mapH - 1)];
  const [wx, wy] = nearestWalkable(sim.grid, cx, cy);
  return [wx * FP + idiv(FP, 2), wy * FP + idiv(FP, 2)];
}

function applyCommand(sim: SimWorld, cmd: Command): void {
  const { MoveTarget, Velocity } = sim.c;
  switch (cmd.type) {
    case 'spawn': {
      const [x, y] = snapWalkable(sim, cmd.x, cmd.y);
      spawnUnit(sim, cmd.playerId, cmd.kind, x, y);
      break;
    }
    case 'move': {
      const [tx, ty] = snapWalkable(sim, cmd.x, cmd.y);
      // Iterate ids as given (the command's own order is part of the record).
      for (const eid of cmd.unitIds) {
        if (!isAlive(sim, eid)) continue;
        MoveTarget.x[eid] = tx;
        MoveTarget.y[eid] = ty;
        MoveTarget.destX[eid] = tx;
        MoveTarget.destY[eid] = ty;
        MoveTarget.amove[eid] = cmd.mode === 'a' ? 1 : 0;
        MoveTarget.active[eid] = 1;
        MoveTarget.stuck[eid] = 0;
      }
      break;
    }
    case 'stop': {
      for (const eid of cmd.unitIds) {
        if (!isAlive(sim, eid)) continue;
        MoveTarget.active[eid] = 0;
        MoveTarget.amove[eid] = 0;
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
      }
      break;
    }
  }
}

/** (unit-scaled trig) * distance / FP. */
function trigScale(trig: number, range: number): number {
  return idiv(trig * range, FP);
}

/** Idle walkers occasionally pick a random direction and stroll (demo crowds). */
function walkerSystem(sim: SimWorld): void {
  const { Position, MoveTarget, Walker } = sim.c;
  for (const eid of sortedAsc(query(sim.world, [Walker, MoveTarget, Position]))) {
    if (MoveTarget.active[eid] === 1) continue;
    Walker.cooldown[eid] = Walker.cooldown[eid]! - 1;
    if (Walker.cooldown[eid]! > 0) continue;
    Walker.cooldown[eid] = TICK_RATE + nextInt(sim.prng, TICK_RATE * 3);
    const angle = nextInt(sim.prng, TURN);
    const range = FP * 2 + nextInt(sim.prng, FP * 6);
    const [tx, ty] = snapWalkable(
      sim,
      Position.x[eid]! + trigScale(fpCos(angle), range),
      Position.y[eid]! + trigScale(fpSin(angle), range),
    );
    MoveTarget.x[eid] = tx;
    MoveTarget.y[eid] = ty;
    MoveTarget.active[eid] = 1;
    MoveTarget.stuck[eid] = 0;
  }
}

/**
 * Combat: acquire the nearest enemy in range, chase it (attack-move and idle
 * units), swing on cooldown, kill at 0 hp. Deterministic: ascending-eid
 * iteration, nearest-then-lowest-eid targeting, immediate kills.
 */
function combatSystem(sim: SimWorld, hash: SpatialHash): void {
  const { Position, Owner, Combat, Health, MoveTarget, Velocity } = sim.c;
  for (const eid of sortedAsc(query(sim.world, [Position, Combat, Owner, MoveTarget]))) {
    if (Combat.cdLeft[eid]! > 0) Combat.cdLeft[eid] = Combat.cdLeft[eid]! - 1;
    if (!isAlive(sim, eid)) continue; // killed earlier this tick
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    const chasing =
      MoveTarget.active[eid] === 1 &&
      (MoveTarget.x[eid] !== MoveTarget.destX[eid] || MoveTarget.y[eid] !== MoveTarget.destY[eid]);
    // Plain move orders (no amove) are honored: don't get distracted.
    const obeyingPlainMove = MoveTarget.active[eid] === 1 && MoveTarget.amove[eid] === 0 && !chasing;
    if (obeyingPlainMove) continue;

    const enemy = hash.nearestEnemy(px, py, Combat.acquire[eid]!, Owner.player[eid]!);
    if (enemy === 0) {
      if (chasing) {
        // Lost the target: resume the original destination.
        MoveTarget.x[eid] = MoveTarget.destX[eid]!;
        MoveTarget.y[eid] = MoveTarget.destY[eid]!;
        MoveTarget.stuck[eid] = 0;
      }
      continue;
    }
    const ex = Position.x[enemy]!;
    const ey = Position.y[enemy]!;
    const d = dist(px, py, ex, ey);
    if (d <= Combat.range[eid]!) {
      // In range: plant feet and swing.
      MoveTarget.active[eid] = 0;
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      if (Combat.cdLeft[eid]! <= 0) {
        Combat.cdLeft[eid] = Combat.cooldown[eid]!;
        Health.hp[enemy] = Health.hp[enemy]! - Combat.damage[eid]!;
        if (Health.hp[enemy]! <= 0) killEntity(sim, enemy);
      }
    } else {
      // Chase. Idle units remember home so they return after the fight.
      if (MoveTarget.active[eid] === 0 && !chasing) {
        MoveTarget.destX[eid] = px;
        MoveTarget.destY[eid] = py;
      }
      MoveTarget.x[eid] = ex;
      MoveTarget.y[eid] = ey;
      MoveTarget.active[eid] = 1;
      MoveTarget.stuck[eid] = 0;
    }
  }
}

/**
 * Fog of war: every 4 ticks, visible cells decay to explored, then every
 * living unit stamps its vision disc. States: 0 unexplored, 1 explored,
 * 2 visible.
 */
const FOG_INTERVAL = 4;

function fogSystem(sim: SimWorld): void {
  if (sim.tick % FOG_INTERVAL !== 0) return;
  const { Position, Owner, Kind } = sim.c;
  const w = sim.grid.w;
  for (const fogGrid of sim.fog) {
    for (let i = 0; i < fogGrid.length; i++) {
      if (fogGrid[i] === 2) fogGrid[i] = 1;
    }
  }
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid)) continue;
    const player = Owner.player[eid]!;
    if (player >= MAX_PLAYERS) continue;
    const fogGrid = sim.fog[player]!;
    const cx = toCell(Position.x[eid]!);
    const cy = toCell(Position.y[eid]!);
    const r = (KIND_STATS[Kind.id[eid]!] ?? KIND_STATS[KIND_WALKER]!).vision;
    const rSq = r * r;
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= sim.grid.h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= w) continue;
        if (dx * dx + dy * dy <= rSq) fogGrid[xx + yy * w] = 2;
      }
    }
  }
}

/**
 * Flow-field movement: far from the target, follow the shared per-order flow
 * field; near it, steer directly. Separation spreads crowds; blocked cells
 * get axis-slid around; units that stop progressing give up (stuck counter).
 */
function movementSystem(sim: SimWorld, hash: SpatialHash): void {
  const { Position, Velocity, MoveTarget } = sim.c;
  const movers = sortedAsc(query(sim.world, [Position, Velocity, MoveTarget]));

  for (const eid of movers) {
    if (MoveTarget.active[eid] !== 1) continue;
    if (!isAlive(sim, eid)) continue; // killed by combat this tick
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    const tx = MoveTarget.x[eid]!;
    const ty = MoveTarget.y[eid]!;
    const d = dist(px, py, tx, ty);
    if (d <= ARRIVE_EPSILON) {
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      MoveTarget.active[eid] = 0;
      if (MoveTarget.x[eid] === MoveTarget.destX[eid] && MoveTarget.y[eid] === MoveTarget.destY[eid]) {
        MoveTarget.amove[eid] = 0; // arrived at the ordered destination
      }
      continue;
    }

    // Desired velocity: direct steer when close/in target cell, else flow field.
    let vx: number;
    let vy: number;
    const cellX = toCell(px);
    const cellY = toCell(py);
    const tCellX = toCell(tx);
    const tCellY = toCell(ty);
    const stepLen = Math.min(WALK_SPEED, d);
    const direct =
      (cellX === tCellX && cellY === tCellY) ||
      d < FP * 2 ||
      (d <= LOS_RANGE && losClear(sim.grid, px, py, tx, ty)) ||
      d <= DIRECT_RANGE;
    if (direct) {
      vx = idiv((tx - px) * stepLen, d);
      vy = idiv((ty - py) * stepLen, d);
    } else {
      const field = sim.flowCache.get(tCellX, tCellY);
      const ci = cellX + cellY * sim.grid.w;
      const fx = field.dx[ci]!;
      const fy = field.dy[ci]!;
      if (fx === 0 && fy === 0) {
        // Unreachable or standing in a blocked/target-disconnected cell:
        // steer directly and let wall-slide + stuck counter sort it out.
        vx = idiv((tx - px) * stepLen, d);
        vy = idiv((ty - py) * stepLen, d);
      } else {
        const scale = fx !== 0 && fy !== 0 ? idiv(WALK_SPEED * DIAG, FP) : WALK_SPEED;
        vx = fx * scale;
        vy = fy * scale;
      }
    }

    // Separation: strongest push ≈ half a step.
    const [sepX, sepY] = hash.separation(eid, px, py, idiv(WALK_SPEED, 2));
    vx += sepX;
    vy += sepY;

    // Clamp combined speed.
    const speed = dist(0, 0, vx, vy);
    if (speed > WALK_SPEED) {
      vx = idiv(vx * WALK_SPEED, speed);
      vy = idiv(vy * WALK_SPEED, speed);
    }

    // Integrate with axis-wise wall sliding.
    let nx = clamp(px + vx, 0, sim.mapW - 1);
    let ny = clamp(py + vy, 0, sim.mapH - 1);
    if (!isWalkable(sim.grid, toCell(nx), toCell(ny))) {
      if (isWalkable(sim.grid, toCell(nx), cellY)) {
        ny = py;
      } else if (isWalkable(sim.grid, cellX, toCell(ny))) {
        nx = px;
      } else {
        nx = px;
        ny = py;
      }
    }

    // Stuck detection.
    if (dist(px, py, nx, ny) < STUCK_EPSILON) {
      MoveTarget.stuck[eid] = MoveTarget.stuck[eid]! + 1;
      if (MoveTarget.stuck[eid]! > STUCK_LIMIT) {
        MoveTarget.active[eid] = 0;
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
        continue;
      }
    } else {
      MoveTarget.stuck[eid] = 0;
    }

    Velocity.x[eid] = nx - px;
    Velocity.y[eid] = ny - py;
    Position.x[eid] = nx;
    Position.y[eid] = ny;
  }
}

/**
 * Advance the sim by one tick. Pure with respect to its inputs: same world
 * state + same commands ⇒ bit-identical next state, on every machine.
 * `commands` must all carry cmd.tick === sim.tick.
 */
export function step(sim: SimWorld, commands: readonly Command[] = []): void {
  for (const cmd of commands) {
    if (cmd.tick !== sim.tick) {
      throw new Error(`command for tick ${cmd.tick} fed to sim at tick ${sim.tick}`);
    }
    applyCommand(sim, cmd);
  }
  walkerSystem(sim);
  const hash = new SpatialHash(sim);
  combatSystem(sim, hash);
  movementSystem(sim, hash);
  fogSystem(sim);
  sim.tick++;
}

/**
 * FNV-1a checksum of all gameplay state: tick, PRNG, map, allocation count,
 * per-entity component membership, and every component field array (used
 * prefix). Two sims are in the same state iff their checksums match (modulo
 * 32-bit collisions).
 */
export function checksum(sim: SimWorld): number {
  let h = FNV_OFFSET;
  h = fnv1aI32(h, sim.tick);
  h = fnv1aI32(h, sim.prng.s);
  h = fnv1aI32(h, mapIndex(sim.mapId));
  h = fnv1aI32(h, sim.allocated);
  for (const fogGrid of sim.fog) {
    h = fnv1aArray(h, fogGrid, fogGrid.length);
  }
  for (const name of COMPONENT_NAMES) {
    const component = sim.c[name];
    for (let eid = 1; eid <= sim.allocated; eid++) {
      h = fnv1aI32(h, hasComponent(sim.world, eid, component) ? 1 : 0);
    }
    for (const [, field] of componentFields(component)) {
      // Live ids are 1..allocated; hashing the unused 0 slot too is harmless.
      h = fnv1aArray(h, field, sim.allocated + 1);
    }
  }
  return h;
}
