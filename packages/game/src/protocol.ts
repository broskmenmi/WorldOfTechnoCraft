// Host ⇄ sim-worker wire protocol.
//
// The worker owns the deterministic sim and its tick clock (it keeps ticking
// when the tab is backgrounded). The host sends *untimed* command inputs; the
// worker stamps them onto the next tick — the stamped stream is the canonical
// record (replay/save/network format).

import type { Command, MapId } from '@wotc/sim';

/** A command as issued by the UI, before the worker assigns its tick. */
export type CommandInput =
  | { playerId: number; type: 'spawn'; kind: number; x: number; y: number }
  | { playerId: number; type: 'move'; unitIds: number[]; x: number; y: number; mode?: 'a' }
  | { playerId: number; type: 'stop'; unitIds: number[] };

export type HostToWorker =
  | { type: 'init'; seed: number; mapId: MapId }
  | { type: 'commands'; inputs: CommandInput[] }
  | { type: 'setRate'; ticksPerSecond: number };

export type WorkerToHost =
  | { type: 'ready' }
  | {
      type: 'snapshot';
      tick: number;
      /** Ints: [tick, count, then per unit: eid, x, y, player, kind, flags]. */
      buffer: ArrayBuffer;
    }
  | { type: 'stamped'; commands: Command[] };

/** Ints per unit in the render snapshot buffer. */
export const SNAPSHOT_STRIDE = 6;
export const SNAPSHOT_HEADER = 2;

/** Snapshot flag bits. */
export const FLAG_MOVING = 1;
