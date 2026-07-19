import { query } from 'bitecs';
import { BUILDINGS, DAMAGE_PCT, DOOR_POLICIES, HEROES_BY_UNIT_ID, UNITS } from '@wotc/data';
import type { Command } from './commands.ts';
import { clamp, dist, FP, fpCos, fpSin, idiv, TURN } from './fp.ts';
import { fnv1aArray, fnv1aI32, FNV_OFFSET } from './hash.ts';
import { isWalkable, losClear, nearestWalkable, toCell } from './map/grid.ts';
import { MATCH_SETUPS } from './map/maps.ts';
import { SpatialHash } from './path/steering.ts';
import { nextInt } from './prng.ts';
import {
  ARMOR_TYPES,
  ATTACK_TYPES,
  buildingDef,
  canPlaceBuilding,
  COMPONENT_NAMES,
  componentFields,
  hasComponent,
  headroom,
  isAlive,
  killEntity,
  mapIndex,
  MAX_PLAYERS,
  AMBIENT,
  NEUTRAL,
  nodeDef,
  QUEUE_SLOTS,
  sortedAsc,
  spawnBuilding,
  spawnCreep,
  spawnHero,
  spawnNode,
  spawnUnit,
  tierOf,
  unitDef,
  type SimWorld,
} from './world.ts';

/** Sim tick rate — 20 Hz. */
export const TICK_RATE = 20;
/** Checksum cadence in ticks. */
export const CHECKSUM_INTERVAL = 10;

/** Day/night cycle: 4 min day, 2 min night. */
export const DAY_TICKS = 4800;
export const CYCLE_TICKS = 7200;
export function isNight(tick: number): boolean {
  return tick % CYCLE_TICKS >= DAY_TICKS;
}

/** Distance at which a move target counts as reached. */
const ARRIVE_EPSILON = idiv(FP, 2);
/** cos(45°) scaled by FP — diagonal speed normalization. */
const DIAG = 724;
const STUCK_LIMIT = 40;
const STUCK_EPSILON = idiv(FP, 64);
const LOS_RANGE = 32 * FP;
const DIRECT_RANGE = 12 * FP;
/** Builders/harvesters interact within this range of a footprint center. */
const INTERACT_RANGE = 3 * FP;
/** Heroes gain XP from kills within this radius. */
const XP_RADIUS = 12 * FP;
/** Police raids: first at this heat, +step each time. */
const RAID_BASE_HEAT = 300;
const RAID_STEP_HEAT = 400;
const MATCH_GRACE_TICKS = 30 * TICK_RATE;
const AI_PLAYER = 1;

// ── Small helpers ───────────────────────────────────────────────────────────

function snapWalkable(sim: SimWorld, x: number, y: number): [number, number] {
  const cx = toCell(clamp(x, 0, sim.mapW - 1));
  const cy = toCell(clamp(y, 0, sim.mapH - 1));
  if (isWalkable(sim.grid, cx, cy)) return [clamp(x, 0, sim.mapW - 1), clamp(y, 0, sim.mapH - 1)];
  const [wx, wy] = nearestWalkable(sim.grid, cx, cy);
  return [wx * FP + idiv(FP, 2), wy * FP + idiv(FP, 2)];
}

function canAfford(sim: SimWorld, player: number, cost: { cash: number; gear: number }): boolean {
  if (player >= MAX_PLAYERS) return true;
  return sim.cash[player]! >= cost.cash && sim.gear[player]! >= cost.gear;
}

function deduct(sim: SimWorld, player: number, cost: { cash: number; gear: number }): void {
  if (player >= MAX_PLAYERS) return;
  sim.cash[player] = sim.cash[player]! - cost.cash;
  sim.gear[player] = sim.gear[player]! - cost.gear;
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

/** Footprint-aware interaction reach for an entity (building or node). */
function reachOf(sim: SimWorld, eid: number): number {
  const { Building, ResourceNode } = sim.c;
  let half = 0;
  if (hasComponent(sim.world, eid, Building)) {
    half = idiv(Math.max(Building.w[eid]!, Building.h[eid]!) * FP, 2);
  } else if (hasComponent(sim.world, eid, ResourceNode)) {
    half = idiv(Math.max(ResourceNode.w[eid]!, ResourceNode.h[eid]!) * FP, 2);
  }
  return INTERACT_RANGE + half;
}

function findBuilding(sim: SimWorld, player: number, predicate?: (eid: number) => boolean): number {
  const { Owner, Building } = sim.c;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid) || Owner.player[eid] !== player) continue;
    if (!hasComponent(sim.world, eid, Building)) continue;
    if (predicate && !predicate(eid)) continue;
    return eid;
  }
  return 0;
}

function nearestDepot(sim: SimWorld, player: number, x: number, y: number): number {
  const { Owner, Building, Position } = sim.c;
  let best = 0;
  let bestD = Number.MAX_SAFE_INTEGER;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid) || Owner.player[eid] !== player) continue;
    if (!hasComponent(sim.world, eid, Building) || Building.complete[eid] !== 1) continue;
    if (!buildingDef(Building.kindId[eid]!).isDepot) continue;
    const d = dist(x, y, Position.x[eid]!, Position.y[eid]!);
    if (d < bestD) {
      bestD = d;
      best = eid;
    }
  }
  return best;
}

/** Nearest surviving node of a resource kind (0 cash / 1 gear). */
function nearestNode(sim: SimWorld, kindIdx: number, x: number, y: number, maxDist: number): number {
  const { ResourceNode, Position } = sim.c;
  let best = 0;
  let bestD = maxDist;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid) || !hasComponent(sim.world, eid, ResourceNode)) continue;
    const def = nodeDef(ResourceNode.defId[eid]!);
    if ((def.kind === 'cash' ? 0 : 1) !== kindIdx) continue;
    const d = dist(x, y, Position.x[eid]!, Position.y[eid]!);
    if (d < bestD) {
      bestD = d;
      best = eid;
    }
  }
  return best;
}

function startHarvest(sim: SimWorld, eid: number, nodeEid: number): void {
  const { Harvester, Position } = sim.c;
  Harvester.node[eid] = nodeEid;
  Harvester.state[eid] = Harvester.carry[eid]! > 0 ? 3 : 1;
  orderMove(sim, eid, Position.x[nodeEid]!, Position.y[nodeEid]!, false);
}

// ── Shared command/AI actions ───────────────────────────────────────────────

function tryTrain(sim: SimWorld, player: number, buildingEid: number, kind: number): boolean {
  const { Building, Owner } = sim.c;
  if (!isAlive(sim, buildingEid) || !hasComponent(sim.world, buildingEid, Building)) return false;
  if (Owner.player[buildingEid] !== player || Building.complete[buildingEid] !== 1) return false;
  const bDef = buildingDef(Building.kindId[buildingEid]!);
  if (!bDef.trains.includes(kind)) return false;
  const uDef = unitDef(kind);
  if (uDef.requiresTier > tierOf(sim, player)) return false;
  if (!canAfford(sim, player, uDef.cost)) return false;
  const hr = headroom(sim, player);
  if (hr.used + uDef.headroom > hr.cap) return false;
  if (Building.prodKind[buildingEid] === -1) {
    deduct(sim, player, uDef.cost);
    Building.prodKind[buildingEid] = kind;
    Building.prodLeft[buildingEid] = uDef.buildTime;
    return true;
  }
  if (Building.prodKind[buildingEid] !== -2 && Building.qLen[buildingEid]! < QUEUE_SLOTS) {
    deduct(sim, player, uDef.cost);
    const slots = [Building.q0, Building.q1, Building.q2, Building.q3, Building.q4];
    slots[Building.qLen[buildingEid]!]![buildingEid] = kind;
    Building.qLen[buildingEid] = Building.qLen[buildingEid]! + 1;
    return true;
  }
  return false;
}

function tryBuild(
  sim: SimWorld,
  player: number,
  builderEid: number,
  kind: number,
  cellX: number,
  cellY: number,
): boolean {
  const { Owner, Kind, Position } = sim.c;
  if (!isAlive(sim, builderEid) || Owner.player[builderEid] !== player) return false;
  if (!unitDef(Kind.id[builderEid]!).isBuilder) return false;
  const def = buildingDef(kind);
  if (def.requiresTier > tierOf(sim, player)) return false;
  if (!canPlaceBuilding(sim, kind, cellX, cellY)) return false;
  if (!canAfford(sim, player, def.cost)) return false;
  deduct(sim, player, def.cost);
  const site = spawnBuilding(sim, player, kind, cellX, cellY, false);
  const [bx, by] = snapWalkable(sim, Position.x[site]!, (cellY + def.h + 1) * FP);
  orderMove(sim, builderEid, bx, by, false);
  return true;
}

function tryUpgrade(sim: SimWorld, player: number, buildingEid: number): boolean {
  const { Building, Owner } = sim.c;
  if (!isAlive(sim, buildingEid) || !hasComponent(sim.world, buildingEid, Building)) return false;
  if (Owner.player[buildingEid] !== player || Building.complete[buildingEid] !== 1) return false;
  if (Building.prodKind[buildingEid] !== -1 || Building.qLen[buildingEid] !== 0) return false;
  const def = buildingDef(Building.kindId[buildingEid]!);
  if (def.upgradesTo === 0) return false;
  if (!canAfford(sim, player, def.upgradeCost)) return false;
  deduct(sim, player, def.upgradeCost);
  Building.prodKind[buildingEid] = -2;
  Building.prodLeft[buildingEid] = def.upgradeTime;
  return true;
}

function tryRevive(sim: SimWorld, player: number): boolean {
  if (player >= MAX_PLAYERS) return false;
  if (sim.heroEid[player] !== 0 || sim.heroKind[player] === 0) return false;
  const heroDef = HEROES_BY_UNIT_ID.get(sim.heroKind[player]!);
  if (!heroDef) return false;
  const depot = nearestDepot(sim, player, idiv(sim.mapW, 2), idiv(sim.mapH, 2));
  if (depot === 0) return false;
  const level = Math.max(1, sim.heroLevel[player]!);
  const cost = { cash: heroDef.reviveBase + heroDef.revivePerLevel * level, gear: 0 };
  if (!canAfford(sim, player, cost)) return false;
  deduct(sim, player, cost);
  const { Position, Building } = sim.c;
  const [sx, sy] = snapWalkable(
    sim,
    Position.x[depot]!,
    (Building.cellY[depot]! + Building.h[depot]! + 1) * FP,
  );
  spawnHero(sim, player, sim.heroKind[player]!, sx, sy);
  return true;
}

// ── Match setup ─────────────────────────────────────────────────────────────

function setupMatch(sim: SimWorld): void {
  const setup = MATCH_SETUPS[sim.mapId];
  if (!setup) return;
  for (const [player, kind, cx, cy] of setup.hqs) spawnBuilding(sim, player, kind, cx, cy, true);
  for (const [kind, cx, cy] of setup.nodes) spawnNode(sim, kind, cx, cy);
  for (const [player, kind, count, cx, cy] of setup.workers) {
    for (let i = 0; i < count; i++) {
      const [x, y] = snapWalkable(sim, (cx + (i % 3) * 2) * FP, (cy + idiv(i, 3) * 2) * FP);
      const worker = spawnUnit(sim, player, kind, x, y);
      // Start the economy: workers head for the nearest Queue immediately.
      const node = nearestNode(sim, 0, x, y, 60 * FP);
      if (node !== 0) startHarvest(sim, worker, node);
    }
  }
  for (const [player, kind, cx, cy] of setup.heroes) {
    const [x, y] = snapWalkable(sim, cx * FP, cy * FP);
    spawnHero(sim, player, kind, x, y);
  }
  for (const [kind, cx, cy] of setup.creeps) {
    const [x, y] = snapWalkable(sim, cx * FP, cy * FP);
    spawnCreep(sim, kind, x, y);
  }
  for (const [kind, count, cx, cy] of setup.ambient) {
    for (let i = 0; i < count; i++) {
      const [x, y] = snapWalkable(sim, (cx + (i % 5) * 2) * FP, (cy + idiv(i, 5) * 2) * FP);
      spawnUnit(sim, AMBIENT, kind, x, y);
    }
  }
  for (let p = 0; p < MAX_PLAYERS; p++) {
    sim.cash[p] = setup.startCash;
    sim.gear[p] = setup.startGear;
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

function applyCommand(sim: SimWorld, cmd: Command): void {
  const { MoveTarget, Velocity, Building, Owner, Harvester } = sim.c;
  const player = cmd.playerId % MAX_PLAYERS;
  switch (cmd.type) {
    case 'setup': {
      setupMatch(sim);
      break;
    }
    case 'spawn': {
      const [x, y] = snapWalkable(sim, cmd.x, cmd.y);
      spawnUnit(sim, cmd.playerId, cmd.kind, x, y);
      break;
    }
    case 'move': {
      const [tx, ty] = snapWalkable(sim, cmd.x, cmd.y);
      for (const eid of cmd.unitIds) {
        if (!isAlive(sim, eid) || Owner.player[eid] !== player) continue;
        if (hasComponent(sim.world, eid, Building)) continue;
        if (hasComponent(sim.world, eid, Harvester)) {
          Harvester.state[eid] = 0;
          Harvester.node[eid] = 0;
        }
        orderMove(sim, eid, tx, ty, cmd.mode === 'a');
      }
      break;
    }
    case 'stop': {
      for (const eid of cmd.unitIds) {
        if (!isAlive(sim, eid) || Owner.player[eid] !== player) continue;
        MoveTarget.active[eid] = 0;
        MoveTarget.amove[eid] = 0;
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
        if (hasComponent(sim.world, eid, Harvester)) {
          Harvester.state[eid] = 0;
          Harvester.node[eid] = 0;
        }
      }
      break;
    }
    case 'harvest': {
      if (!isAlive(sim, cmd.nodeId) || !hasComponent(sim.world, cmd.nodeId, sim.c.ResourceNode)) break;
      for (const eid of cmd.unitIds) {
        if (!isAlive(sim, eid) || Owner.player[eid] !== player) continue;
        if (!hasComponent(sim.world, eid, Harvester)) continue;
        startHarvest(sim, eid, cmd.nodeId);
      }
      break;
    }
    case 'build': {
      tryBuild(sim, player, cmd.builderId, cmd.kind, cmd.cellX, cmd.cellY);
      break;
    }
    case 'spawnBuilding': {
      if (canPlaceBuilding(sim, cmd.kind, cmd.cellX, cmd.cellY)) {
        spawnBuilding(sim, cmd.playerId, cmd.kind, cmd.cellX, cmd.cellY, true);
      }
      break;
    }
    case 'train': {
      tryTrain(sim, player, cmd.buildingId, cmd.kind);
      break;
    }
    case 'upgrade': {
      tryUpgrade(sim, player, cmd.buildingId);
      break;
    }
    case 'revive': {
      tryRevive(sim, player);
      break;
    }
    case 'ability': {
      castAbility(sim, player, cmd.heroId, cmd.slot, cmd.x, cmd.y);
      break;
    }
    case 'rally': {
      const b = cmd.buildingId;
      if (!isAlive(sim, b) || !hasComponent(sim.world, b, Building)) break;
      if (Owner.player[b] !== player) break;
      const [rx, ry] = snapWalkable(sim, cmd.x, cmd.y);
      Building.rallyX[b] = rx;
      Building.rallyY[b] = ry;
      break;
    }
    case 'policy': {
      if (cmd.value >= 0 && cmd.value < DOOR_POLICIES.length) {
        sim.policy[player] = cmd.value;
      }
      break;
    }
    case 'grant': {
      sim.cash[player] = sim.cash[player]! + (cmd.cash | 0);
      sim.gear[player] = sim.gear[player]! + (cmd.gear | 0);
      break;
    }
  }
}

// ── Hero abilities ──────────────────────────────────────────────────────────

const HERO_CDS = ['cd0', 'cd1', 'cd2', 'cd3'] as const;

function castAbility(
  sim: SimWorld,
  player: number,
  heroId: number,
  slot: number,
  x: number,
  y: number,
): void {
  const { Hero, Owner, Position, Kind, Health, Stunned } = sim.c;
  if (slot < 0 || slot > 3) return;
  if (!isAlive(sim, heroId) || !hasComponent(sim.world, heroId, Hero)) return;
  if (Owner.player[heroId] !== player) return;
  const heroDef = HEROES_BY_UNIT_ID.get(Kind.id[heroId]!);
  if (!heroDef) return;
  const ability = heroDef.abilities[slot];
  if (!ability) return;
  if (Hero.level[heroId]! < ability.unlockLevel) return;
  const cdField = HERO_CDS[slot]!;
  if (Hero[cdField][heroId]! > 0) return;
  if (Hero.hype100[heroId]! < ability.hypeCost * 100) return;

  const hx = Position.x[heroId]!;
  const hy = Position.y[heroId]!;
  // Clamp targeted casts to range along the ray.
  let tx = x;
  let ty = y;
  if (ability.range > 0) {
    const d = dist(hx, hy, x, y);
    if (d > ability.range) {
      tx = hx + idiv((x - hx) * ability.range, d);
      ty = hy + idiv((y - hy) * ability.range, d);
    }
  } else {
    tx = hx;
    ty = hy;
  }

  switch (ability.effect) {
    case 'burst': {
      for (const other of livingInRadius(sim, tx, ty, ability.radius)) {
        if (Owner.player[other] === player) continue;
        damageEntity(sim, heroId, other, ability.amount);
      }
      break;
    }
    case 'healPulse': {
      for (const other of livingInRadius(sim, hx, hy, ability.radius)) {
        if (Owner.player[other] !== player) continue;
        if (!hasComponent(sim.world, other, Health)) continue;
        Health.hp[other] = Math.min(Health.max[other]!, Health.hp[other]! + ability.amount);
      }
      break;
    }
    case 'dash': {
      const [dx, dy] = snapWalkable(sim, tx, ty);
      Position.x[heroId] = dx;
      Position.y[heroId] = dy;
      sim.c.MoveTarget.active[heroId] = 0;
      break;
    }
    case 'stun': {
      for (const other of livingInRadius(sim, hx, hy, ability.radius)) {
        if (Owner.player[other] === player) continue;
        damageEntity(sim, heroId, other, ability.amount);
        if (isAlive(sim, other) && !hasComponent(sim.world, other, sim.c.Building)) {
          if (!hasComponent(sim.world, other, Stunned)) {
            const { addComponent } = simBitecs;
            addComponent(sim.world, other, Stunned);
            Stunned.ticks[other] = 0;
          }
          Stunned.ticks[other] = Math.max(Stunned.ticks[other]!, ability.stunTicks);
        }
      }
      break;
    }
  }
  Hero[cdField][heroId] = ability.cooldown;
  Hero.hype100[heroId] = Hero.hype100[heroId]! - ability.hypeCost * 100;
}

/** All living entities within radius of a point (ascending eid). */
function livingInRadius(sim: SimWorld, x: number, y: number, radius: number): number[] {
  const { Position } = sim.c;
  const out: number[] = [];
  const rSq = radius * radius;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid)) continue;
    const dx = Position.x[eid]! - x;
    const dy = Position.y[eid]! - y;
    if (dx * dx + dy * dy <= rSq) out.push(eid);
  }
  return out;
}

// ── Damage & XP ─────────────────────────────────────────────────────────────

/** Apply typed damage; on kill, pay bounty and hero XP, then remove. */
function damageEntity(sim: SimWorld, attacker: number, target: number, baseDamage: number): void {
  const { Health, Combat, Owner, Position, Kind } = sim.c;
  if (!hasComponent(sim.world, target, Health)) return;
  const atkIdx = hasComponent(sim.world, attacker, Combat) ? Combat.atkType[attacker]! : 0;
  const armIdx = Health.armor[target]!;
  const pct = DAMAGE_PCT[ATTACK_TYPES[atkIdx]!][ARMOR_TYPES[armIdx]!];
  const dmg = Math.max(1, idiv(baseDamage * pct, 100));
  Health.hp[target] = Health.hp[target]! - dmg;
  if (Health.hp[target]! > 0) return;

  // Death: bounty + hero XP to the killer's side, then removal.
  const killerOwner = Owner.player[attacker]!;
  const deathX = Position.x[target]!;
  const deathY = Position.y[target]!;
  let bounty = 0;
  let xpValue = 30;
  if (hasComponent(sim.world, target, Kind)) {
    const def = unitDef(Kind.id[target]!);
    bounty = def.bounty;
    xpValue = def.xpValue;
  }
  killEntity(sim, target);
  if (killerOwner < MAX_PLAYERS) {
    if (bounty > 0) sim.cash[killerOwner] = sim.cash[killerOwner]! + bounty;
    const heroEid = sim.heroEid[killerOwner]!;
    if (xpValue > 0 && heroEid !== 0 && isAlive(sim, heroEid)) {
      if (dist(Position.x[heroEid]!, Position.y[heroEid]!, deathX, deathY) <= XP_RADIUS) {
        gainXp(sim, heroEid, xpValue);
      }
    }
  }
}

function gainXp(sim: SimWorld, heroEid: number, amount: number): void {
  const { Hero, Kind, Health, Combat, Owner } = sim.c;
  const heroDef = HEROES_BY_UNIT_ID.get(Kind.id[heroEid]!);
  if (!heroDef) return;
  Hero.xp[heroEid] = Hero.xp[heroEid]! + amount;
  while (
    Hero.level[heroEid]! < heroDef.maxLevel &&
    Hero.xp[heroEid]! >= heroDef.xpBase * Hero.level[heroEid]!
  ) {
    Hero.xp[heroEid] = Hero.xp[heroEid]! - heroDef.xpBase * Hero.level[heroEid]!;
    Hero.level[heroEid] = Hero.level[heroEid]! + 1;
    Health.max[heroEid] = Health.max[heroEid]! + heroDef.hpPerLevel;
    Health.hp[heroEid] = Math.min(Health.max[heroEid]!, Health.hp[heroEid]! + heroDef.hpPerLevel);
    Combat.damage[heroEid] = Combat.damage[heroEid]! + heroDef.damagePerLevel;
  }
  const p = Owner.player[heroEid]!;
  if (p < MAX_PLAYERS) {
    sim.heroLevel[p] = Hero.level[heroEid]!;
    sim.heroXp[p] = Hero.xp[heroEid]!;
  }
}

// ── Systems ─────────────────────────────────────────────────────────────────

/** (unit-scaled trig) * distance / FP. */
function trigScale(trig: number, range: number): number {
  return idiv(trig * range, FP);
}

/** Idle wanderers (ambient ravers) stroll randomly. */
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
    orderMove(sim, eid, tx, ty, false);
  }
}

/** Harvest cycle: toNode → harvest → toDepot → deposit → back. */
function harvestSystem(sim: SimWorld): void {
  const { Harvester, Position, MoveTarget, ResourceNode } = sim.c;
  for (const eid of sortedAsc(query(sim.world, [Harvester, Position, MoveTarget]))) {
    if (!isAlive(sim, eid)) continue;
    const state = Harvester.state[eid]!;
    if (state === 0) continue;
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    const owner = sim.c.Owner.player[eid]!;

    if (state === 1) {
      // Walking to the node.
      let node = Harvester.node[eid]!;
      if (!isAlive(sim, node) || !hasComponent(sim.world, node, ResourceNode)) {
        const kindIdx = Harvester.carryKind[eid]!;
        node = nearestNode(sim, kindIdx, px, py, 40 * FP);
        if (node === 0) {
          Harvester.state[eid] = 0;
          continue;
        }
        startHarvest(sim, eid, node);
        continue;
      }
      if (dist(px, py, Position.x[node]!, Position.y[node]!) <= reachOf(sim, node)) {
        const def = nodeDef(ResourceNode.defId[node]!);
        Harvester.state[eid] = 2;
        Harvester.timer[eid] = def.harvestTime;
        Harvester.carryKind[eid] = def.kind === 'cash' ? 0 : 1;
        MoveTarget.active[eid] = 0;
      } else if (MoveTarget.active[eid] === 0) {
        orderMove(sim, eid, Position.x[node]!, Position.y[node]!, false);
      }
      continue;
    }

    if (state === 2) {
      // Harvesting in place.
      const node = Harvester.node[eid]!;
      if (!isAlive(sim, node)) {
        Harvester.state[eid] = 1;
        continue;
      }
      Harvester.timer[eid] = Harvester.timer[eid]! - 1;
      if (Harvester.timer[eid]! > 0) continue;
      const def = nodeDef(ResourceNode.defId[node]!);
      const take = Math.min(def.carry, ResourceNode.remaining[node]!);
      ResourceNode.remaining[node] = ResourceNode.remaining[node]! - take;
      Harvester.carry[eid] = take;
      if (ResourceNode.remaining[node]! <= 0) killEntity(sim, node);
      Harvester.state[eid] = 3;
      const depot = nearestDepot(sim, owner, px, py);
      if (depot === 0) {
        Harvester.state[eid] = 0;
        continue;
      }
      orderMove(sim, eid, Position.x[depot]!, Position.y[depot]!, false);
      continue;
    }

    if (state === 3) {
      // Carrying to the depot.
      const depot = nearestDepot(sim, owner, px, py);
      if (depot === 0) {
        Harvester.state[eid] = 0;
        continue;
      }
      if (dist(px, py, Position.x[depot]!, Position.y[depot]!) <= reachOf(sim, depot)) {
        if (owner < MAX_PLAYERS) {
          if (Harvester.carryKind[eid] === 0) sim.cash[owner] = sim.cash[owner]! + Harvester.carry[eid]!;
          else sim.gear[owner] = sim.gear[owner]! + Harvester.carry[eid]!;
        }
        Harvester.carry[eid] = 0;
        let node = Harvester.node[eid]!;
        if (!isAlive(sim, node)) node = nearestNode(sim, Harvester.carryKind[eid]!, px, py, 40 * FP);
        if (node === 0) {
          Harvester.state[eid] = 0;
        } else {
          Harvester.node[eid] = node;
          Harvester.state[eid] = 1;
          orderMove(sim, eid, Position.x[node]!, Position.y[node]!, false);
        }
      } else if (MoveTarget.active[eid] === 0) {
        orderMove(sim, eid, Position.x[depot]!, Position.y[depot]!, false);
      }
      continue;
    }
  }
}

/**
 * Combat: acquire the nearest enemy in range, chase it (attack-move and idle
 * units), swing on cooldown. Turret buildings fight without moving. Creeps
 * leash back to their camp. Deterministic throughout.
 */
function combatSystem(sim: SimWorld, hash: SpatialHash): void {
  const { Position, Owner, Combat, MoveTarget, Velocity, Guard, Stunned, Health, Building } = sim.c;
  for (const eid of sortedAsc(query(sim.world, [Position, Combat, Owner]))) {
    if (Combat.cdLeft[eid]! > 0) Combat.cdLeft[eid] = Combat.cdLeft[eid]! - 1;
    if (!isAlive(sim, eid)) continue; // killed earlier this tick
    if (hasComponent(sim.world, eid, Stunned)) continue;
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    const mobile = hasComponent(sim.world, eid, MoveTarget);

    // Creep leash: too far from home → run back, heal, ignore everything.
    if (hasComponent(sim.world, eid, Guard)) {
      if (Guard.returning[eid] === 1) {
        if (dist(px, py, Guard.homeX[eid]!, Guard.homeY[eid]!) <= FP * 2) {
          Guard.returning[eid] = 0;
          Health.hp[eid] = Health.max[eid]!;
        } else {
          if (MoveTarget.active[eid] === 0) orderMove(sim, eid, Guard.homeX[eid]!, Guard.homeY[eid]!, false);
          continue;
        }
      } else if (dist(px, py, Guard.homeX[eid]!, Guard.homeY[eid]!) > Guard.leash[eid]!) {
        Guard.returning[eid] = 1;
        orderMove(sim, eid, Guard.homeX[eid]!, Guard.homeY[eid]!, false);
        continue;
      }
    }

    const chasing =
      mobile &&
      MoveTarget.active[eid] === 1 &&
      (MoveTarget.x[eid] !== MoveTarget.destX[eid] || MoveTarget.y[eid] !== MoveTarget.destY[eid]);
    const obeyingPlainMove =
      mobile && MoveTarget.active[eid] === 1 && MoveTarget.amove[eid] === 0 && !chasing;
    if (obeyingPlainMove) continue;

    const enemy = hash.nearestEnemy(px, py, Combat.acquire[eid]!, Owner.player[eid]!);
    if (enemy === 0) {
      if (chasing) {
        MoveTarget.x[eid] = MoveTarget.destX[eid]!;
        MoveTarget.y[eid] = MoveTarget.destY[eid]!;
        MoveTarget.stuck[eid] = 0;
      }
      continue;
    }
    const ex = Position.x[enemy]!;
    const ey = Position.y[enemy]!;
    const d = dist(px, py, ex, ey);
    let range = Combat.range[eid]!;
    if (hasComponent(sim.world, enemy, Building)) {
      range += idiv(Math.max(Building.w[enemy]!, Building.h[enemy]!) * FP, 2);
    }
    if (d <= range) {
      if (mobile) {
        MoveTarget.active[eid] = 0;
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
      }
      if (Combat.cdLeft[eid]! <= 0) {
        Combat.cdLeft[eid] = Combat.cooldown[eid]!;
        damageEntity(sim, eid, enemy, Combat.damage[eid]!);
      }
    } else if (mobile) {
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

/** Builders near an unfinished building advance construction. */
function constructionSystem(sim: SimWorld): void {
  const { Position, Owner, Building, Kind } = sim.c;
  const sites = sortedAsc(query(sim.world, [Building, Position, Owner]));
  const builders: number[] = [];
  for (const eid of sortedAsc(query(sim.world, [Kind, Position, Owner]))) {
    if (isAlive(sim, eid) && unitDef(Kind.id[eid]!).isBuilder) builders.push(eid);
  }
  for (const site of sites) {
    if (Building.complete[site] === 1 || !isAlive(sim, site)) continue;
    const def = buildingDef(Building.kindId[site]!);
    const reach = reachOf(sim, site);
    let crew = 0;
    for (const b of builders) {
      if (Owner.player[b] !== Owner.player[site]) continue;
      if (dist(Position.x[b]!, Position.y[b]!, Position.x[site]!, Position.y[site]!) <= reach) crew++;
    }
    if (crew === 0) continue;
    Building.progress[site] = Building.progress[site]! + crew;
    // Construction also heals up to full as it completes.
    const { Health } = sim.c;
    Health.hp[site] = Math.min(Health.max[site]!, Health.hp[site]! + crew);
    if (Building.progress[site]! >= def.buildTime) {
      Building.complete[site] = 1;
      Health.hp[site] = Health.max[site]!;
    }
  }
}

/** Production queues tick down; finished units pop out and walk to rally.
 * prodKind -2 = tier upgrade in progress. */
function productionSystem(sim: SimWorld): void {
  const { Position, Owner, Building, Health } = sim.c;
  for (const b of sortedAsc(query(sim.world, [Building, Position, Owner]))) {
    if (!isAlive(sim, b) || Building.complete[b] !== 1 || Building.prodKind[b] === -1) continue;
    Building.prodLeft[b] = Building.prodLeft[b]! - 1;
    if (Building.prodLeft[b]! > 0) continue;

    if (Building.prodKind[b] === -2) {
      // Tier upgrade completes: transform in place.
      const def = buildingDef(Building.kindId[b]!);
      const next = buildingDef(def.upgradesTo);
      Building.kindId[b] = next.id;
      Health.max[b] = next.hp;
      Health.hp[b] = Math.min(next.hp, Health.hp[b]! + (next.hp - def.hp));
      Building.prodKind[b] = -1;
      continue;
    }

    const kind = Building.prodKind[b]!;
    const [sx, sy] = snapWalkable(
      sim,
      Position.x[b]!,
      (Building.cellY[b]! + Building.h[b]!) * FP + idiv(FP, 2),
    );
    const unit = spawnUnit(sim, Owner.player[b]!, kind, sx, sy);
    if (unitDef(kind).isHarvester) {
      // Rally onto a node = start working (WC3 behavior).
      const node = nearestNode(sim, 0, Building.rallyX[b]!, Building.rallyY[b]!, 12 * FP);
      if (node !== 0) startHarvest(sim, unit, node);
      else orderMove(sim, unit, Building.rallyX[b]!, Building.rallyY[b]!, false);
    } else {
      orderMove(sim, unit, Building.rallyX[b]!, Building.rallyY[b]!, false);
    }
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

/** Once per second: heat accrual + hero hype/cooldowns. */
function upkeepSystem(sim: SimWorld): void {
  const { Hero, Kind } = sim.c;
  // Hero regen/cooldowns every tick.
  for (const eid of sortedAsc(query(sim.world, [Hero, Kind]))) {
    if (!isAlive(sim, eid)) continue;
    const heroDef = HEROES_BY_UNIT_ID.get(Kind.id[eid]!);
    if (!heroDef) continue;
    Hero.hype100[eid] = Math.min(heroDef.hypeMax * 100, Hero.hype100[eid]! + heroDef.hypeRegenPer100);
    if (Hero.cd0[eid]! > 0) Hero.cd0[eid] = Hero.cd0[eid]! - 1;
    if (Hero.cd1[eid]! > 0) Hero.cd1[eid] = Hero.cd1[eid]! - 1;
    if (Hero.cd2[eid]! > 0) Hero.cd2[eid] = Hero.cd2[eid]! - 1;
    if (Hero.cd3[eid]! > 0) Hero.cd3[eid] = Hero.cd3[eid]! - 1;
  }
  if (sim.tick % TICK_RATE !== 0) return;
  const { Owner, Building } = sim.c;
  for (const b of sortedAsc(query(sim.world, [Building, Owner]))) {
    if (!isAlive(sim, b) || Building.complete[b] !== 1) continue;
    const owner = Owner.player[b]!;
    if (owner >= MAX_PLAYERS) continue;
    const def = buildingDef(Building.kindId[b]!);
    if (def.heatPerSec > 0) {
      const policy = DOOR_POLICIES[sim.policy[owner]!]!;
      sim.heat[owner] = sim.heat[owner]! + idiv(def.heatPerSec * policy.heatPct, 100);
    }
  }
}

/** Stun ticks down. */
function stunSystem(sim: SimWorld): void {
  const { Stunned } = sim.c;
  for (const eid of sortedAsc(query(sim.world, [Stunned]))) {
    Stunned.ticks[eid] = Stunned.ticks[eid]! - 1;
    if (Stunned.ticks[eid]! <= 0) {
      const { removeComponent } = simBitecs;
      removeComponent(sim.world, eid, Stunned);
    }
  }
}

/** Heat thresholds send police (neutral) at the offender's HQ. */
function raidSystem(sim: SimWorld): void {
  if (sim.tick % TICK_RATE !== 0) return;
  const threshold = RAID_BASE_HEAT + sim.raidsSpawned * RAID_STEP_HEAT;
  if (sim.heat[0]! < threshold && sim.heat[1]! < threshold) return;
  const offender = sim.heat[0]! >= threshold ? 0 : 1;
  sim.raidsSpawned++;
  // The council is satisfied. Temporarily. As is policy.
  sim.heat[offender] = 0;
  const { Position } = sim.c;
  const hq = findBuilding(sim, offender);
  if (hq === 0) return;
  const count = 3 + sim.raidsSpawned;
  for (let i = 0; i < count; i++) {
    const [sx, sy] = snapWalkable(sim, idiv(sim.mapW, 2) + (i - idiv(count, 2)) * FP * 2, idiv(sim.mapH, 2));
    const cop = spawnUnit(sim, NEUTRAL, UNITS.undercover_cop.id, sx, sy);
    orderMove(sim, cop, Position.x[hq]!, Position.y[hq]!, true);
  }
}

/** The Legion AI: plays the actual game. Thinks once a second. */
const AI_BUILD_ORDER: Array<{ kind?: number; upgrade?: boolean }> = [
  { kind: BUILDINGS.generator.id },
  { kind: BUILDINGS.tent.id },
  { kind: BUILDINGS.generator.id },
  { upgrade: true },
  { kind: BUILDINGS.tent.id },
  { kind: BUILDINGS.generator.id },
  { upgrade: true },
  { kind: BUILDINGS.generator.id },
];

const AI_PLACEMENTS: Array<[number, number]> = [
  [6, -3], [6, 5], [-4, 6], [8, 1], [0, 8], [10, 6], [6, 10], [-6, 0], [12, 2], [2, 12], [-4, -4], [14, 8],
];

function legionAiSystem(sim: SimWorld): void {
  if (sim.matchState !== 0 || sim.tick % TICK_RATE !== 10) return;
  const { Owner, Kind, Building, Position, Harvester } = sim.c;
  const p = AI_PLAYER;

  // Census.
  let hq = 0;
  const tents: number[] = [];
  const workers: number[] = [];
  const army: number[] = [];
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid) || Owner.player[eid] !== p) continue;
    if (hasComponent(sim.world, eid, Building)) {
      if (Building.complete[eid] !== 1) continue;
      const def = buildingDef(Building.kindId[eid]!);
      if (def.isDepot) hq = hq || eid;
      if (def.trains.length > 0 && !def.isDepot) tents.push(eid);
    } else if (hasComponent(sim.world, eid, Kind)) {
      const def = unitDef(Kind.id[eid]!);
      if (def.isHarvester) workers.push(eid);
      else if (!HEROES_BY_UNIT_ID.has(def.id)) army.push(eid);
    }
  }
  if (hq === 0) return;
  if (sim.aiState[2] === 0) sim.aiState[2] = 8;

  // Hero down? Save up and bring him back.
  if (sim.heroEid[p] === 0) tryRevive(sim, p);

  // Worker line.
  if (workers.length < 7) tryTrain(sim, p, hq, UNITS.roadie.id);

  // Idle workers go harvest: 4 on cash, rest on gear.
  let cashWorkers = 0;
  for (const w of workers) {
    if (Harvester.state[w] !== 0 && Harvester.carryKind[w] === 0) cashWorkers++;
  }
  for (const w of workers) {
    if (Harvester.state[w] !== 0) continue;
    const wantKind = cashWorkers < 4 ? 0 : 1;
    const node = nearestNode(sim, wantKind, Position.x[w]!, Position.y[w]!, 60 * FP);
    if (node !== 0) {
      startHarvest(sim, w, node);
      if (wantKind === 0) cashWorkers++;
    }
  }

  // Build order, then standing rules: never supply-block, keep barracks up.
  const aiPlace = (kind: number): boolean => {
    const def = buildingDef(kind);
    if (!canAfford(sim, p, def.cost) || def.requiresTier > tierOf(sim, p)) return false;
    if (workers.length === 0) return false;
    const hqCellX = Building.cellX[hq]!;
    const hqCellY = Building.cellY[hq]!;
    for (const [dx, dy] of AI_PLACEMENTS) {
      if (canPlaceBuilding(sim, kind, hqCellX + dx, hqCellY + dy)) {
        return tryBuild(sim, p, workers[0]!, kind, hqCellX + dx, hqCellY + dy);
      }
    }
    return false;
  };
  const step = sim.aiState[0]!;
  const entry = AI_BUILD_ORDER[step];
  if (entry) {
    if (entry.upgrade) {
      if (tryUpgrade(sim, p, hq)) sim.aiState[0] = step + 1;
    } else if (entry.kind !== undefined) {
      if (aiPlace(entry.kind)) sim.aiState[0] = step + 1;
    }
  } else {
    const hr = headroom(sim, p);
    if (hr.cap - hr.used < 6 && hr.cap < 90) aiPlace(BUILDINGS.generator.id);
    else if (tents.length < 3) aiPlace(BUILDINGS.tent.id);
  }

  // Army production.
  for (const tent of tents) {
    const tier = tierOf(sim, p);
    const counter = sim.aiState[3]!;
    let kind: number = UNITS.gabber.id;
    if (tier >= 2 && counter % 3 === 1) kind = UNITS.hakken_bruiser.id;
    if (tier >= 2 && counter % 4 === 3) kind = UNITS.uptempo_screamer.id;
    if (tryTrain(sim, p, tent, kind)) sim.aiState[3] = counter + 1;
  }

  // Attack wave: full-strength when the threshold is met, or an overdue push
  // with whatever's on hand — supply-blocked one short of the threshold must
  // not mean the Legion sits at home forever.
  const lastAttack = sim.aiState[1]!;
  const sinceAttack = sim.tick - lastAttack;
  const fullWave = army.length >= sim.aiState[2]! && sinceAttack > 45 * TICK_RATE;
  const overdueWave = army.length >= 4 && sinceAttack > 180 * TICK_RATE;
  if (fullWave || overdueWave) {
    const target = findBuilding(sim, 0);
    if (target !== 0) {
      for (const u of army) orderMove(sim, u, Position.x[target]!, Position.y[target]!, true);
      const heroEid = sim.heroEid[p]!;
      if (heroEid !== 0 && isAlive(sim, heroEid)) {
        orderMove(sim, heroEid, Position.x[target]!, Position.y[target]!, true);
      }
      sim.aiState[1] = sim.tick;
      if (fullWave) sim.aiState[2] = Math.min(24, sim.aiState[2]! + 4);
    }
  }
}

/** Raze victory: a side with no buildings left has lost. */
function matchSystem(sim: SimWorld): void {
  if (sim.matchState !== 0 || sim.tick % TICK_RATE !== 0) return;
  if (sim.tick < MATCH_GRACE_TICKS) return;
  const { Owner, Building } = sim.c;
  let p0 = 0;
  let p1 = 0;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid) || !hasComponent(sim.world, eid, Building)) continue;
    if (Owner.player[eid] === 0) p0++;
    else if (Owner.player[eid] === 1) p1++;
  }
  if (p0 === 0 && p1 === 0) return;
  if (p0 === 0) sim.matchState = 2;
  else if (p1 === 0) sim.matchState = 1;
}

/**
 * Fog of war: every 4 ticks, visible cells decay to explored, then every
 * living unit/building stamps its vision disc (reduced at night).
 */
const FOG_INTERVAL = 4;

function fogSystem(sim: SimWorld): void {
  if (sim.tick % FOG_INTERVAL !== 0) return;
  const { Position, Owner, Kind, Building } = sim.c;
  const w = sim.grid.w;
  const night = isNight(sim.tick);
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
    let r: number;
    if (hasComponent(sim.world, eid, Building)) {
      r = buildingDef(Building.kindId[eid]!).vision;
    } else if (hasComponent(sim.world, eid, Kind)) {
      r = unitDef(Kind.id[eid]!).vision;
    } else {
      continue;
    }
    if (night) r = Math.max(3, idiv(r * 3, 5));
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

/** Flow-field movement with separation, wall sliding and stuck detection. */
function movementSystem(sim: SimWorld, hash: SpatialHash): void {
  const { Position, Velocity, MoveTarget, Kind, Stunned } = sim.c;
  const movers = sortedAsc(query(sim.world, [Position, Velocity, MoveTarget, Kind]));

  for (const eid of movers) {
    if (MoveTarget.active[eid] !== 1) continue;
    if (!isAlive(sim, eid)) continue;
    if (hasComponent(sim.world, eid, Stunned)) continue;
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
        MoveTarget.amove[eid] = 0;
      }
      continue;
    }

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
        vx = idiv((tx - px) * stepLen, d);
        vy = idiv((ty - py) * stepLen, d);
      } else {
        const scale = fx !== 0 && fy !== 0 ? idiv(speed * DIAG, FP) : speed;
        vx = fx * scale;
        vy = fy * scale;
      }
    }

    const [sepX, sepY] = hash.separation(eid, px, py, idiv(speed, 2));
    vx += sepX;
    vy += sepY;

    const combined = dist(0, 0, vx, vy);
    if (combined > speed) {
      vx = idiv(vx * speed, combined);
      vy = idiv(vy * speed, combined);
    }

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
  harvestSystem(sim);
  constructionSystem(sim);
  productionSystem(sim);
  upkeepSystem(sim);
  stunSystem(sim);
  raidSystem(sim);
  legionAiSystem(sim);
  matchSystem(sim);
  movementSystem(sim, hash);
  fogSystem(sim);
  sim.tick++;
}

// bitecs functions used inside systems without polluting the import list above.
import { addComponent as bitecsAdd, removeComponent as bitecsRemove } from 'bitecs';
const simBitecs = { addComponent: bitecsAdd, removeComponent: bitecsRemove };

/**
 * FNV-1a checksum of all gameplay state. Two sims are in the same state iff
 * their checksums match (modulo 32-bit collisions).
 */
export function checksum(sim: SimWorld): number {
  let h = FNV_OFFSET;
  h = fnv1aI32(h, sim.tick);
  h = fnv1aI32(h, sim.prng.s);
  h = fnv1aI32(h, mapIndex(sim.mapId));
  h = fnv1aI32(h, sim.allocated);
  h = fnv1aI32(h, sim.raidsSpawned);
  h = fnv1aI32(h, sim.matchState);
  h = fnv1aArray(h, sim.aiState, sim.aiState.length);
  h = fnv1aArray(h, sim.cash, sim.cash.length);
  h = fnv1aArray(h, sim.gear, sim.gear.length);
  h = fnv1aArray(h, sim.heat, sim.heat.length);
  h = fnv1aArray(h, sim.policy, sim.policy.length);
  h = fnv1aArray(h, sim.heroKind, sim.heroKind.length);
  h = fnv1aArray(h, sim.heroLevel, sim.heroLevel.length);
  h = fnv1aArray(h, sim.heroXp, sim.heroXp.length);
  h = fnv1aArray(h, sim.heroEid, sim.heroEid.length);
  for (const fogGrid of sim.fog) {
    h = fnv1aArray(h, fogGrid, fogGrid.length);
  }
  for (const name of COMPONENT_NAMES) {
    const component = sim.c[name];
    for (let eid = 1; eid <= sim.allocated; eid++) {
      h = fnv1aI32(h, hasComponent(sim.world, eid, component) ? 1 : 0);
    }
    for (const [, field] of componentFields(component)) {
      h = fnv1aArray(h, field, sim.allocated + 1);
    }
  }
  return h;
}
