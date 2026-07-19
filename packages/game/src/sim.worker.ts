// The sim worker: owns the deterministic world and the 20 Hz tick clock.
// Timers are allowed HERE (this file is presentation-side plumbing); the sim
// package itself stays clock-free.

import {
  buildingDef,
  createSim,
  hasComponent,
  isAlive,
  step,
  TICK_RATE,
  type Command,
  type SimWorld,
} from '@wotc/sim';
import {
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  type CommandInput,
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

/** Pack live entity state: [tick, count, (eid,x,y,player,kind,flags,hp,max,progressPct)*]. */
function renderSnapshot(s: SimWorld): ArrayBuffer {
  const { Position, Owner, Kind, MoveTarget, Health, Building } = s.c;
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
    out[o++] = eid;
    out[o++] = Position.x[eid]!;
    out[o++] = Position.y[eid]!;
    out[o++] = Owner.player[eid]!;
    out[o++] = isBuilding ? Building.kindId[eid]! : Kind.id[eid]!;
    out[o++] =
      (!isBuilding && MoveTarget.active[eid] === 1 ? 1 : 0) | (isBuilding ? 2 : 0);
    out[o++] = Health.hp[eid]!;
    out[o++] = Health.max[eid]!;
    out[o++] = isBuilding
      ? Building.complete[eid] === 1
        ? 100
        : Math.min(99, Math.floor((Building.progress[eid]! * 100) / buildingDef(Building.kindId[eid]!).buildTime))
      : 100;
  }
  return out.buffer;
}

/** Send the local player's fog every 8 ticks (it only changes every 4). */
const FOG_SEND_INTERVAL = 8;

function tickOnce(): void {
  if (!sim) return;
  // Stamp queued inputs onto this tick — this stream is the canonical record.
  // In replay mode the recorded stream IS the input.
  const commands: Command[] = replayByTick
    ? (replayByTick.get(sim.tick) ?? [])
    : pendingInputs.map((input) => ({ ...input, tick: sim!.tick }) as Command);
  pendingInputs = [];
  step(sim, commands);
  if (!replayByTick && commands.length > 0) post({ type: 'stamped', commands });
  const buffer = renderSnapshot(sim);
  const resources = {
    cash: sim.cash[0]!,
    vibe: sim.vibe[0]!,
    heat: sim.heat[0]!,
    policy: sim.policy[0]!,
    matchState: sim.matchState,
    sunriseTick: sim.sunriseTick,
    raidsSpawned: sim.raidsSpawned,
    wavesSpawned: sim.wavesSpawned,
    peakVibe: sim.peakVibe,
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
