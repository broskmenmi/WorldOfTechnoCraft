// Host-side handle on the sim worker: command outbox, snapshot double-buffer,
// and the interpolation clock the renderer reads. Never extrapolates — the
// renderer always shows a blend of the last two confirmed sim states.

import { FP, type MapId } from '@wotc/sim';
import {
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  type CommandInput,
  type HostToWorker,
  type WorkerToHost,
} from './protocol.ts';

export interface UnitView {
  eid: number;
  /** Interpolated position in world cells (float — presentation only). */
  x: number;
  y: number;
  player: number;
  kind: number;
  moving: boolean;
  building: boolean;
  hp: number;
  maxHp: number;
  /** Construction percent (100 for units/complete buildings). */
  progress: number;
}

interface Snapshot {
  tick: number;
  receivedAt: number;
  data: Int32Array;
  /** eid → offset of the unit's record in `data`. */
  index: Map<number, number>;
}

function parseSnapshot(buffer: ArrayBuffer, receivedAt: number): Snapshot {
  const data = new Int32Array(buffer);
  const count = data[1]!;
  const index = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
    index.set(data[o]!, o);
  }
  return { tick: data[0]!, receivedAt, data, index };
}

export class SimHost {
  private worker: Worker;
  private prev: Snapshot | null = null;
  private curr: Snapshot | null = null;
  private outbox: CommandInput[] = [];
  onReady: (() => void) | null = null;
  /** Fires after each new snapshot is in place (waypoint queues hook here). */
  onSnapshot: (() => void) | null = null;
  /** Latest player-0 fog grid (0 unexplored / 1 explored / 2 visible). */
  fog: Uint8Array | null = null;
  /** Latest player-0 resources. */
  cash = 0;
  vibe = 0;
  heat = 0;
  policy = 1;

  constructor() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerToHost>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        this.onReady?.();
      } else if (msg.type === 'snapshot') {
        this.prev = this.curr;
        this.curr = parseSnapshot(msg.buffer, performance.now());
        if (msg.fog) this.fog = new Uint8Array(msg.fog);
        this.cash = msg.cash;
        this.vibe = msg.vibe;
        this.heat = msg.heat;
        this.policy = msg.policy;
        this.flushOutbox();
        this.onSnapshot?.();
      }
      // 'stamped' messages become the replay log in M9.
    };
  }

  start(seed: number, mapId: MapId = 'empty256'): void {
    this.send({ type: 'init', seed, mapId });
  }

  issue(...inputs: CommandInput[]): void {
    this.outbox.push(...inputs);
    this.flushOutbox();
  }

  get tick(): number {
    return this.curr?.tick ?? 0;
  }

  /**
   * Interpolated view of all live units at render time. `now` is
   * performance.now(); positions blend prev→curr snapshots.
   */
  units(now: number, out: UnitView[] = []): UnitView[] {
    out.length = 0;
    const curr = this.curr;
    if (!curr) return out;
    const prev = this.prev;
    let alpha = 1;
    if (prev && curr.receivedAt > prev.receivedAt) {
      alpha = (now - curr.receivedAt) / (curr.receivedAt - prev.receivedAt);
      alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    }
    const count = curr.data[1]!;
    for (let i = 0; i < count; i++) {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
      const eid = curr.data[o]!;
      const cx = curr.data[o + 1]!;
      const cy = curr.data[o + 2]!;
      let x = cx;
      let y = cy;
      const po = prev?.index.get(eid);
      if (po !== undefined) {
        const px = prev!.data[po + 1]!;
        const py = prev!.data[po + 2]!;
        x = px + (cx - px) * alpha;
        y = py + (cy - py) * alpha;
      }
      out.push({
        eid,
        x: x / FP,
        y: y / FP,
        player: curr.data[o + 3]!,
        kind: curr.data[o + 4]!,
        moving: (curr.data[o + 5]! & 1) === 1,
        building: (curr.data[o + 5]! & 2) === 2,
        hp: curr.data[o + 6]!,
        maxHp: curr.data[o + 7]!,
        progress: curr.data[o + 8]!,
      });
    }
    return out;
  }

  /** Is this unit currently executing a move order (per latest snapshot)? */
  isMoving(eid: number): boolean {
    const o = this.curr?.index.get(eid);
    return o !== undefined && (this.curr!.data[o + 5]! & 1) === 1;
  }

  /** Is this unit alive in the latest snapshot? */
  isAlive(eid: number): boolean {
    return this.curr?.index.has(eid) ?? false;
  }

  private flushOutbox(): void {
    if (this.outbox.length === 0) return;
    this.send({ type: 'commands', inputs: this.outbox });
    this.outbox = [];
  }

  private send(msg: HostToWorker): void {
    this.worker.postMessage(msg);
  }
}
