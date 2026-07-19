// The sim worker: owns the deterministic world and the 20 Hz tick clock.
// Timers are allowed HERE (this file is presentation-side plumbing); the sim
// package itself stays clock-free.

import {
  createSim,
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

function post(msg: WorkerToHost, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, { transfer: transfer ?? [] });
}

/** Pack live unit state for the renderer: [tick, count, (eid,x,y,player,kind,flags)*]. */
function renderSnapshot(s: SimWorld): ArrayBuffer {
  const { Position, Owner, Kind, MoveTarget } = s.c;
  const eids: number[] = [];
  for (let eid = 1; eid <= s.allocated; eid++) {
    if (isAlive(s, eid)) eids.push(eid);
  }
  const out = new Int32Array(SNAPSHOT_HEADER + eids.length * SNAPSHOT_STRIDE);
  out[0] = s.tick;
  out[1] = eids.length;
  let o = SNAPSHOT_HEADER;
  for (const eid of eids) {
    out[o++] = eid;
    out[o++] = Position.x[eid]!;
    out[o++] = Position.y[eid]!;
    out[o++] = Owner.player[eid]!;
    out[o++] = Kind.id[eid]!;
    out[o++] = MoveTarget.active[eid] === 1 ? 1 : 0; // FLAG_MOVING
  }
  return out.buffer;
}

function tickOnce(): void {
  if (!sim) return;
  // Stamp queued inputs onto this tick — this stream is the canonical record.
  const commands: Command[] = pendingInputs.map(
    (input) => ({ ...input, tick: sim!.tick }) as Command,
  );
  pendingInputs = [];
  step(sim, commands);
  if (commands.length > 0) post({ type: 'stamped', commands });
  const buffer = renderSnapshot(sim);
  post({ type: 'snapshot', tick: sim.tick, buffer }, [buffer]);
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
