import { query } from 'bitecs';
import type { Command } from './commands.ts';
import { clamp, dist, FP, fpCos, fpSin, idiv, TURN } from './fp.ts';
import { fnv1aArray, fnv1aI32, FNV_OFFSET } from './hash.ts';
import { nextInt } from './prng.ts';
import {
  COMPONENT_NAMES,
  componentFields,
  hasComponent,
  isAlive,
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
const ARRIVE_EPSILON = idiv(FP, 4);

function applyCommand(sim: SimWorld, cmd: Command): void {
  const { MoveTarget, Velocity } = sim.c;
  switch (cmd.type) {
    case 'spawn': {
      const x = clamp(cmd.x, 0, sim.mapW - 1);
      const y = clamp(cmd.y, 0, sim.mapH - 1);
      spawnUnit(sim, cmd.playerId, cmd.kind, x, y);
      break;
    }
    case 'move': {
      // Iterate ids as given (the command's own order is part of the record).
      for (const eid of cmd.unitIds) {
        if (!isAlive(sim, eid)) continue;
        MoveTarget.x[eid] = clamp(cmd.x, 0, sim.mapW - 1);
        MoveTarget.y[eid] = clamp(cmd.y, 0, sim.mapH - 1);
        MoveTarget.active[eid] = 1;
      }
      break;
    }
    case 'stop': {
      for (const eid of cmd.unitIds) {
        if (!isAlive(sim, eid)) continue;
        MoveTarget.active[eid] = 0;
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

/** Idle walkers occasionally pick a random direction and stroll (M1/M2 demo). */
function walkerSystem(sim: SimWorld): void {
  const { Position, MoveTarget, Walker } = sim.c;
  for (const eid of sortedAsc(query(sim.world, [Walker, MoveTarget, Position]))) {
    if (MoveTarget.active[eid] === 1) continue;
    Walker.cooldown[eid] = Walker.cooldown[eid]! - 1;
    if (Walker.cooldown[eid]! > 0) continue;
    Walker.cooldown[eid] = TICK_RATE + nextInt(sim.prng, TICK_RATE * 3);
    const angle = nextInt(sim.prng, TURN);
    const range = FP * 2 + nextInt(sim.prng, FP * 6);
    MoveTarget.x[eid] = clamp(Position.x[eid]! + trigScale(fpCos(angle), range), 0, sim.mapW - 1);
    MoveTarget.y[eid] = clamp(Position.y[eid]! + trigScale(fpSin(angle), range), 0, sim.mapH - 1);
    MoveTarget.active[eid] = 1;
  }
}

/** Move active movers toward their target at WALK_SPEED; arrive and stop. */
function movementSystem(sim: SimWorld): void {
  const { Position, Velocity, MoveTarget } = sim.c;
  for (const eid of sortedAsc(query(sim.world, [Position, Velocity, MoveTarget]))) {
    if (MoveTarget.active[eid] !== 1) continue;
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    const tx = MoveTarget.x[eid]!;
    const ty = MoveTarget.y[eid]!;
    const d = dist(px, py, tx, ty);
    if (d <= ARRIVE_EPSILON || d === 0) {
      Position.x[eid] = tx;
      Position.y[eid] = ty;
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      MoveTarget.active[eid] = 0;
      continue;
    }
    const stepLen = Math.min(WALK_SPEED, d);
    const vx = idiv((tx - px) * stepLen, d);
    const vy = idiv((ty - py) * stepLen, d);
    Velocity.x[eid] = vx;
    Velocity.y[eid] = vy;
    Position.x[eid] = clamp(px + vx, 0, sim.mapW - 1);
    Position.y[eid] = clamp(py + vy, 0, sim.mapH - 1);
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
  movementSystem(sim);
  sim.tick++;
}

/**
 * FNV-1a checksum of all gameplay state: tick, PRNG, allocation count,
 * per-entity component membership, and every component field array (used
 * prefix). Two sims are in the same state iff their checksums match (modulo
 * 32-bit collisions).
 */
export function checksum(sim: SimWorld): number {
  let h = FNV_OFFSET;
  h = fnv1aI32(h, sim.tick);
  h = fnv1aI32(h, sim.prng.s);
  h = fnv1aI32(h, sim.allocated);
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
