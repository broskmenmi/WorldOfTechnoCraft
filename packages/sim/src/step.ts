import { query } from 'bitecs';
import { DOOR_POLICIES, UNITS } from '@wotc/data';
import type { Command } from './commands.ts';
import { clamp, dist, FP, fpCos, fpSin, idiv, TURN } from './fp.ts';
import { fnv1aArray, fnv1aI32, FNV_OFFSET } from './hash.ts';
import { isWalkable, losClear, nearestWalkable, toCell } from './map/grid.ts';
import { SpatialHash } from './path/steering.ts';
import { nextInt } from './prng.ts';
import {
  buildingDef,
  canPlaceBuilding,
  COMPONENT_NAMES,
  componentFields,
  hasComponent,
  isAlive,
  killEntity,
  mapIndex,
  MAX_PLAYERS,
  QUEUE_SLOTS,
  sortedAsc,
  spawnBuilding,
  spawnUnit,
  unitDef,
  type SimWorld,
} from './world.ts';

/** Sim tick rate — 20 Hz. */
export const TICK_RATE = 20;
/** Checksum cadence in ticks. */
export const CHECKSUM_INTERVAL = 10;

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
/** Builders work within this range of the building center. */
const BUILD_RANGE = 3 * FP;
/** First raid at this much Heat; each subsequent raid needs +150 more. */
const RAID_BASE_HEAT = 100;
const RAID_STEP_HEAT = 150;

/** Snap a sub-unit position to the center of the nearest walkable cell. */
function snapWalkable(sim: SimWorld, x: number, y: number): [number, number] {
  const cx = toCell(clamp(x, 0, sim.mapW - 1));
  const cy = toCell(clamp(y, 0, sim.mapH - 1));
  if (isWalkable(sim.grid, cx, cy)) return [clamp(x, 0, sim.mapW - 1), clamp(y, 0, sim.mapH - 1)];
  const [wx, wy] = nearestWalkable(sim.grid, cx, cy);
  return [wx * FP + idiv(FP, 2), wy * FP + idiv(FP, 2)];
}

function canAfford(sim: SimWorld, player: number, cost: { cash: number; vibe: number }): boolean {
  return sim.cash[player]! >= cost.cash && sim.vibe[player]! >= cost.vibe;
}

function deduct(sim: SimWorld, player: number, cost: { cash: number; vibe: number }): void {
  sim.cash[player] = sim.cash[player]! - cost.cash;
  sim.vibe[player] = sim.vibe[player]! - cost.vibe;
}

function orderMove(sim: SimWorld, eid: number, tx: number, ty: number, amove: boolean): void {
  const { MoveTarget } = sim.c;
  MoveTarget.x[eid] = tx;
  MoveTarget.y[eid] = ty;
  MoveTarget.destX[eid] = tx;
  MoveTarget.destY[eid] = ty;
  MoveTarget.amove[eid] = amove ? 1 : 0;
  MoveTarget.active[eid] = 1;
  MoveTarget.stuck[eid] = 0;
}

function applyCommand(sim: SimWorld, cmd: Command): void {
  const { MoveTarget, Velocity, Building, Owner } = sim.c;
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
        if (hasComponent(sim.world, eid, Building)) continue;
        orderMove(sim, eid, tx, ty, cmd.mode === 'a');
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
    case 'build': {
      if (!isAlive(sim, cmd.builderId)) break;
      if (Owner.player[cmd.builderId] !== cmd.playerId % MAX_PLAYERS) break;
      const def = buildingDef(cmd.kind);
      if (!canPlaceBuilding(sim, cmd.kind, cmd.cellX, cmd.cellY)) break;
      if (!canAfford(sim, cmd.playerId % MAX_PLAYERS, def.cost)) break;
      deduct(sim, cmd.playerId % MAX_PLAYERS, def.cost);
      const site = spawnBuilding(sim, cmd.playerId, cmd.kind, cmd.cellX, cmd.cellY, false);
      // Send the builder to the site edge.
      const { Position } = sim.c;
      const [bx, by] = snapWalkable(sim, Position.x[site]!, (cmd.cellY + def.h) * FP + idiv(FP, 2));
      orderMove(sim, cmd.builderId, bx, by, false);
      break;
    }
    case 'spawnBuilding': {
      if (canPlaceBuilding(sim, cmd.kind, cmd.cellX, cmd.cellY)) {
        spawnBuilding(sim, cmd.playerId, cmd.kind, cmd.cellX, cmd.cellY, true);
      }
      break;
    }
    case 'train': {
      const b = cmd.buildingId;
      if (!isAlive(sim, b) || !hasComponent(sim.world, b, Building)) break;
      if (Owner.player[b] !== cmd.playerId % MAX_PLAYERS) break;
      if (Building.complete[b] !== 1) break;
      const bDef = buildingDef(Building.kindId[b]!);
      if (!bDef.trains.includes(cmd.kind)) break;
      const uDef = unitDef(cmd.kind);
      if (!canAfford(sim, cmd.playerId % MAX_PLAYERS, uDef.cost)) break;
      if (Building.prodKind[b] === -1) {
        deduct(sim, cmd.playerId % MAX_PLAYERS, uDef.cost);
        Building.prodKind[b] = cmd.kind;
        Building.prodLeft[b] = uDef.buildTime;
      } else if (Building.qLen[b]! < QUEUE_SLOTS) {
        deduct(sim, cmd.playerId % MAX_PLAYERS, uDef.cost);
        const slots = [Building.q0, Building.q1, Building.q2, Building.q3, Building.q4];
        slots[Building.qLen[b]!]![b] = cmd.kind;
        Building.qLen[b] = Building.qLen[b]! + 1;
      }
      break;
    }
    case 'rally': {
      const b = cmd.buildingId;
      if (!isAlive(sim, b) || !hasComponent(sim.world, b, Building)) break;
      if (Owner.player[b] !== cmd.playerId % MAX_PLAYERS) break;
      const [rx, ry] = snapWalkable(sim, cmd.x, cmd.y);
      Building.rallyX[b] = rx;
      Building.rallyY[b] = ry;
      break;
    }
    case 'policy': {
      if (cmd.value >= 0 && cmd.value < DOOR_POLICIES.length) {
        sim.policy[cmd.playerId % MAX_PLAYERS] = cmd.value;
      }
      break;
    }
    case 'grant': {
      const p = cmd.playerId % MAX_PLAYERS;
      sim.cash[p] = sim.cash[p]! + (cmd.cash | 0);
      sim.vibe[p] = sim.vibe[p]! + (cmd.vibe | 0);
      break;
    }
  }
}

/** (unit-scaled trig) * distance / FP. */
function trigScale(trig: number, range: number): number {
  return idiv(trig * range, FP);
}

/** Idle wanderers (Clubgoers) stroll randomly — the dancefloor crowd. */
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
    MoveTarget.destX[eid] = tx;
    MoveTarget.destY[eid] = ty;
    MoveTarget.active[eid] = 1;
    MoveTarget.stuck[eid] = 0;
  }
}

/** Melee reach against a building extends to its footprint edge. */
function effectiveRange(sim: SimWorld, attacker: number, target: number): number {
  const { Combat, Building } = sim.c;
  let range = Combat.range[attacker]!;
  if (hasComponent(sim.world, target, Building)) {
    range += idiv(Math.max(Building.w[target]!, Building.h[target]!) * FP, 2);
  }
  return range;
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
    if (d <= effectiveRange(sim, eid, enemy)) {
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

/** Builders (Cable Guys) near an unfinished building advance construction. */
function constructionSystem(sim: SimWorld): void {
  const { Position, Owner, Building, Kind } = sim.c;
  const sites = sortedAsc(query(sim.world, [Building, Position, Owner]));
  const builders: number[] = [];
  for (const eid of sortedAsc(query(sim.world, [Kind, Position, Owner]))) {
    if (Kind.id[eid] === UNITS.cable_guy.id && isAlive(sim, eid)) builders.push(eid);
  }
  for (const site of sites) {
    if (Building.complete[site] === 1 || !isAlive(sim, site)) continue;
    const def = buildingDef(Building.kindId[site]!);
    const reach = BUILD_RANGE + idiv(Math.max(def.w, def.h) * FP, 2);
    let crew = 0;
    for (const b of builders) {
      if (Owner.player[b] !== Owner.player[site]) continue;
      if (dist(Position.x[b]!, Position.y[b]!, Position.x[site]!, Position.y[site]!) <= reach) crew++;
    }
    if (crew === 0) continue;
    Building.progress[site] = Building.progress[site]! + crew;
    if (Building.progress[site]! >= def.buildTime) {
      Building.complete[site] = 1;
    }
  }
}

/** Production queues tick down; finished units pop out and walk to rally. */
function productionSystem(sim: SimWorld): void {
  const { Position, Owner, Building } = sim.c;
  for (const b of sortedAsc(query(sim.world, [Building, Position, Owner]))) {
    if (!isAlive(sim, b) || Building.complete[b] !== 1 || Building.prodKind[b] === -1) continue;
    Building.prodLeft[b] = Building.prodLeft[b]! - 1;
    if (Building.prodLeft[b]! > 0) continue;
    const kind = Building.prodKind[b]!;
    // Spawn at the footprint's south edge, then rally.
    const [sx, sy] = snapWalkable(
      sim,
      Position.x[b]!,
      (Building.cellY[b]! + Building.h[b]!) * FP + idiv(FP, 2),
    );
    const unit = spawnUnit(sim, Owner.player[b]!, kind, sx, sy);
    if (Building.rallyX[b] !== 0 || Building.rallyY[b] !== 0) {
      orderMove(sim, unit, Building.rallyX[b]!, Building.rallyY[b]!, false);
    }
    // Pop the queue.
    if (Building.qLen[b]! > 0) {
      const slots = [Building.q0, Building.q1, Building.q2, Building.q3, Building.q4];
      const next = slots[0]![b]!;
      for (let i = 0; i < Building.qLen[b]! - 1; i++) slots[i]![b] = slots[i + 1]![b]!;
      Building.qLen[b] = Building.qLen[b]! - 1;
      Building.prodKind[b] = next;
      Building.prodLeft[b] = unitDef(next).buildTime;
    } else {
      Building.prodKind[b] = -1;
      Building.prodLeft[b] = 0;
    }
  }
}

/** Once per second: building income, dancefloor Vibe, Heat accrual. */
function economySystem(sim: SimWorld): void {
  if (sim.tick % TICK_RATE !== 0) return;
  const { Position, Owner, Building, Walker } = sim.c;
  // Collect dancers once (crowd units).
  const dancers: number[] = [];
  for (const eid of sortedAsc(query(sim.world, [Walker, Position, Owner]))) {
    if (isAlive(sim, eid)) dancers.push(eid);
  }
  for (const b of sortedAsc(query(sim.world, [Building, Position, Owner]))) {
    if (!isAlive(sim, b) || Building.complete[b] !== 1) continue;
    const owner = Owner.player[b]!;
    const def = buildingDef(Building.kindId[b]!);
    const policy = DOOR_POLICIES[sim.policy[owner]!]!;
    sim.cash[owner] = sim.cash[owner]! + def.cashPerSec;
    if (def.vibePerDancerSec > 0) {
      let crowd = 0;
      const radius = def.danceRadius * FP;
      for (const d of dancers) {
        if (Owner.player[d] !== owner) continue;
        if (dist(Position.x[d]!, Position.y[d]!, Position.x[b]!, Position.y[b]!) <= radius) crowd++;
      }
      sim.vibe[owner] =
        sim.vibe[owner]! + idiv(crowd * def.vibePerDancerSec * policy.vibeIncomePct, 100);
    }
    if (def.heatPerSec > 0) {
      sim.heat[owner] = sim.heat[owner]! + idiv(def.heatPerSec * policy.heatPct, 100);
    }
  }
}

/** Heat thresholds spawn raids at the north edge, attack-moving on the club. */
function raidSystem(sim: SimWorld): void {
  if (sim.tick % TICK_RATE !== 0) return;
  const threshold = RAID_BASE_HEAT + sim.raidsSpawned * RAID_STEP_HEAT;
  if (sim.heat[0]! < threshold) return;
  sim.raidsSpawned++;
  const { Position, Owner, Building } = sim.c;
  // Target: player 0's lowest-eid building, else map center.
  let tx = idiv(sim.mapW, 2);
  let ty = idiv(sim.mapH, 2);
  for (const b of sortedAsc(query(sim.world, [Building, Position, Owner]))) {
    if (isAlive(sim, b) && Owner.player[b] === 0) {
      tx = Position.x[b]!;
      ty = Position.y[b]!;
      break;
    }
  }
  const count = 3 + sim.raidsSpawned * 2;
  for (let i = 0; i < count; i++) {
    const kind = i % 3 === 2 ? UNITS.hakken_bruiser.id : UNITS.gabber.id;
    const [sx, sy] = snapWalkable(sim, idiv(sim.mapW, 2) + (i - idiv(count, 2)) * FP * 2, 4 * FP);
    const raider = spawnUnit(sim, 1, kind, sx, sy);
    orderMove(sim, raider, tx, ty, true);
  }
}

/**
 * Fog of war: every 4 ticks, visible cells decay to explored, then every
 * living unit/building stamps its vision disc. States: 0 unexplored,
 * 1 explored, 2 visible.
 */
const FOG_INTERVAL = 4;

function fogSystem(sim: SimWorld): void {
  if (sim.tick % FOG_INTERVAL !== 0) return;
  const { Position, Owner, Kind, Building } = sim.c;
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
    const r = hasComponent(sim.world, eid, Building)
      ? buildingDef(Building.kindId[eid]!).vision
      : unitDef(Kind.id[eid]!).vision;
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
  const { Position, Velocity, MoveTarget, Kind } = sim.c;
  const movers = sortedAsc(query(sim.world, [Position, Velocity, MoveTarget, Kind]));

  for (const eid of movers) {
    if (MoveTarget.active[eid] !== 1) continue;
    if (!isAlive(sim, eid)) continue; // killed by combat this tick
    const speed = Kind.speed[eid]!;
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
    const stepLen = Math.min(speed, d);
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
        const scale = fx !== 0 && fy !== 0 ? idiv(speed * DIAG, FP) : speed;
        vx = fx * scale;
        vy = fy * scale;
      }
    }

    // Separation: strongest push ≈ half a step.
    const [sepX, sepY] = hash.separation(eid, px, py, idiv(speed, 2));
    vx += sepX;
    vy += sepY;

    // Clamp combined speed.
    const combined = dist(0, 0, vx, vy);
    if (combined > speed) {
      vx = idiv(vx * speed, combined);
      vy = idiv(vy * speed, combined);
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
  constructionSystem(sim);
  productionSystem(sim);
  economySystem(sim);
  raidSystem(sim);
  movementSystem(sim, hash);
  fogSystem(sim);
  sim.tick++;
}

/**
 * FNV-1a checksum of all gameplay state: tick, PRNG, map, resources, fog,
 * allocation count, per-entity component membership, and every component
 * field array (used prefix). Two sims are in the same state iff their
 * checksums match (modulo 32-bit collisions).
 */
export function checksum(sim: SimWorld): number {
  let h = FNV_OFFSET;
  h = fnv1aI32(h, sim.tick);
  h = fnv1aI32(h, sim.prng.s);
  h = fnv1aI32(h, mapIndex(sim.mapId));
  h = fnv1aI32(h, sim.allocated);
  h = fnv1aI32(h, sim.raidsSpawned);
  h = fnv1aArray(h, sim.cash, sim.cash.length);
  h = fnv1aArray(h, sim.vibe, sim.vibe.length);
  h = fnv1aArray(h, sim.heat, sim.heat.length);
  h = fnv1aArray(h, sim.policy, sim.policy.length);
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
