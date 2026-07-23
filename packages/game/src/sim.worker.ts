// The sim worker: owns the deterministic world and the 20 Hz tick clock.
// Timers are allowed HERE (this file is presentation-side plumbing); the sim
// package itself stays clock-free.

import { HEROES_BY_UNIT_ID } from '@wotc/data';
import {
  createSim,
  hasComponent,
  headroom,
  isAlive,
  isNight,
  step,
  TICK_RATE,
  tierOf,
  type Command,
  type SimWorld,
} from '@wotc/sim';
import {
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  type CommandInput,
  type HeroStatus,
  type HostToWorker,
  type WorkerToHost,
} from './protocol.ts';

let sim: SimWorld | null = null;
let pendingInputs: CommandInput[] = [];
let intervalMs = 1000 / TICK_RATE;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Replay playback: recorded commands by tick; live inputs are ignored. */
let replayByTick: Map<number, Command[]> | null = null;

function post(msg: WorkerToHost, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, { transfer: transfer ?? [] });
}

/** Pack live entity state: [tick, count, (eid,x,y,player,kind,flags,hp,max,progress)*]. */
function renderSnapshot(s: SimWorld): ArrayBuffer {
  const { Position, Owner, Kind, MoveTarget, Health, Building, ResourceNode, Hero, Harvester } = s.c;
  const eids: number[] = [];
  for (let eid = 1; eid <= s.allocated; eid++) {
    if (isAlive(s, eid)) eids.push(eid);
  }
  const out = new Int32Array(SNAPSHOT_HEADER + eids.length * SNAPSHOT_STRIDE);
  out[0] = s.tick;
  out[1] = eids.length;
  let o = SNAPSHOT_HEADER;
  for (const eid of eids) {
    const isBuilding = hasComponent(s.world, eid, Building);
    const isNode = hasComponent(s.world, eid, ResourceNode);
    const isHero = hasComponent(s.world, eid, Hero);
    const isHarvester = hasComponent(s.world, eid, Harvester);
    const carrying = isHarvester && Harvester.carry[eid]! > 0;
    const idleWorker = isHarvester && Harvester.state[eid] === 0 && MoveTarget.active[eid] !== 1;
    let kind: number;
    let progress = 100;
    if (isBuilding) {
      kind = Building.kindId[eid]!;
      progress =
        Building.complete[eid] === 1
          ? 100
          : Math.min(99, Math.floor((Building.progress[eid]! * 100) / Math.max(1, buildingBuildTime(kind))));
    } else if (isNode) {
      kind = ResourceNode.defId[eid]!;
      progress = Math.floor((ResourceNode.remaining[eid]! * 100) / Math.max(1, nodeReserve(kind)));
    } else {
      kind = Kind.id[eid]!;
    }
    out[o++] = eid;
    out[o++] = Position.x[eid]!;
    out[o++] = Position.y[eid]!;
    out[o++] = Owner.player[eid]!;
    out[o++] = kind;
    out[o++] =
      (!isBuilding && !isNode && MoveTarget.active[eid] === 1 ? 1 : 0) |
      (isBuilding ? 2 : 0) |
      (isNode ? 4 : 0) |
      (isHero ? 8 : 0) |
      (carrying ? 16 : 0) |
      (idleWorker ? 32 : 0);
    out[o++] = Health.hp[eid]!;
    out[o++] = Health.max[eid]!;
    out[o++] = progress;
  }
  return out.buffer;
}

import { buildingDef, nodeDef } from '@wotc/sim';
function buildingBuildTime(kind: number): number {
  return buildingDef(kind).buildTime;
}
function nodeReserve(kind: number): number {
  return nodeDef(kind).reserve;
}

function heroStatus(s: SimWorld): HeroStatus {
  const { Hero } = s.c;
  const eid = s.heroEid[0]!;
  const kind = s.heroKind[0]!;
  const def = HEROES_BY_UNIT_ID.get(kind);
  const level = Math.max(1, s.heroLevel[0]!);
  const reviveCost = def ? def.reviveBase + def.revivePerLevel * level : 0;
  if (eid === 0 || !isAlive(s, eid) || !def) {
    return { eid: 0, level, xp: s.heroXp[0]!, xpNext: def ? def.xpBase * level : 0, hype: 0, hypeMax: def?.hypeMax ?? 0, cds: [0, 0, 0, 0], reviveCost };
  }
  return {
    eid,
    level: Hero.level[eid]!,
    xp: Hero.xp[eid]!,
    xpNext: def.xpBase * Hero.level[eid]!,
    hype: Math.floor(Hero.hype100[eid]! / 100),
    hypeMax: def.hypeMax,
    cds: [Hero.cd0[eid]!, Hero.cd1[eid]!, Hero.cd2[eid]!, Hero.cd3[eid]!],
    reviveCost,
  };
}

/** Send the local player's fog every 8 ticks (it only changes every 4). */
const FOG_SEND_INTERVAL = 8;

function tickOnce(): void {
  if (!sim) return;
  const commands: Command[] = replayByTick
    ? (replayByTick.get(sim.tick) ?? [])
    : pendingInputs.map((input) => ({ ...input, tick: sim!.tick }) as Command);
  pendingInputs = [];
  step(sim, commands);
  if (!replayByTick && commands.length > 0) post({ type: 'stamped', commands });
  const buffer = renderSnapshot(sim);
  const hr = headroom(sim, 0);
  const resources = {
    cash: sim.cash[0]!,
    gear: sim.gear[0]!,
    heat: sim.heat[0]!,
    policy: sim.policy[0]!,
    headroomUsed: hr.used,
    headroomCap: hr.cap,
    tier: tierOf(sim, 0),
    night: isNight(sim.tick),
    matchState: sim.matchState,
    raidsSpawned: sim.raidsSpawned,
    hero: heroStatus(sim),
  };
  if (sim.tick % FOG_SEND_INTERVAL === 0) {
    const fog = sim.fog[0]!.slice().buffer;
    post({ type: 'snapshot', tick: sim.tick, buffer, fog, ...resources }, [buffer, fog]);
  } else {
    post({ type: 'snapshot', tick: sim.tick, buffer, ...resources }, [buffer]);
  }
}

function loop(): void {
  tickOnce();
  timer = setTimeout(loop, intervalMs);
}

self.onmessage = (ev: MessageEvent<HostToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      if (timer !== null) clearTimeout(timer);
      sim = createSim(msg.seed, { mapId: msg.mapId });
      replayByTick = null;
      if (msg.replay) {
        replayByTick = new Map();
        for (const c of msg.replay) {
          const list = replayByTick.get(c.tick);
          if (list) list.push(c);
          else replayByTick.set(c.tick, [c]);
        }
      }
      post({ type: 'ready' });
      loop();
      break;
    }
    case 'commands': {
      pendingInputs.push(...msg.inputs);
      break;
    }
    case 'setRate': {
      intervalMs = 1000 / msg.ticksPerSecond;
      break;
    }
  }
};
