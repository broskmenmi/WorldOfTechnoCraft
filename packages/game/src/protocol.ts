// Host ⇄ sim-worker wire protocol.
//
// The worker owns the deterministic sim and its tick clock (it keeps ticking
// when the tab is backgrounded). The host sends *untimed* command inputs; the
// worker stamps them onto the next tick — the stamped stream is the canonical
// record (replay/save/network format).

import type { Command, MapId } from '@wotc/sim';

/** A command as issued by the UI, before the worker assigns its tick. */
export type CommandInput =
  | { playerId: number; type: 'setup' }
  | { playerId: number; type: 'spawn'; kind: number; x: number; y: number }
  | { playerId: number; type: 'move'; unitIds: number[]; x: number; y: number; mode?: 'a' }
  | { playerId: number; type: 'stop'; unitIds: number[] }
  | { playerId: number; type: 'harvest'; unitIds: number[]; nodeId: number }
  | { playerId: number; type: 'build'; builderId: number; kind: number; cellX: number; cellY: number }
  | { playerId: number; type: 'spawnBuilding'; kind: number; cellX: number; cellY: number }
  | { playerId: number; type: 'train'; buildingId: number; kind: number }
  | { playerId: number; type: 'upgrade'; buildingId: number }
  | { playerId: number; type: 'revive' }
  | { playerId: number; type: 'ability'; heroId: number; slot: number; x: number; y: number }
  | { playerId: number; type: 'rally'; buildingId: number; x: number; y: number }
  | { playerId: number; type: 'policy'; value: number }
  | { playerId: number; type: 'grant'; cash: number; gear: number };

export interface HeroStatus {
  /** Alive hero entity id, 0 = dead/none. */
  eid: number;
  level: number;
  xp: number;
  xpNext: number;
  hype: number;
  hypeMax: number;
  /** Remaining cooldown ticks per slot (Q/W/E/R). */
  cds: [number, number, number, number];
  reviveCost: number;
}

export type HostToWorker =
  | {
      type: 'init';
      seed: number;
      mapId: MapId;
      /** Replay playback: feed this recorded stream, ignore live inputs. */
      replay?: Command[];
    }
  | { type: 'commands'; inputs: CommandInput[] }
  | { type: 'setRate'; ticksPerSecond: number };

export type WorkerToHost =
  | { type: 'ready' }
  | {
      type: 'snapshot';
      tick: number;
      /** Ints: [tick, count, then per entity:
       *  eid, x, y, player, kind, flags, hp, maxHp, progressPct]. */
      buffer: ArrayBuffer;
      /** Player-0 fog grid, sent periodically. */
      fog?: ArrayBuffer;
      cash: number;
      gear: number;
      heat: number;
      policy: number;
      headroomUsed: number;
      headroomCap: number;
      tier: number;
      night: boolean;
      matchState: number;
      raidsSpawned: number;
      hero: HeroStatus;
    }
  | { type: 'stamped'; commands: Command[] };

/** Ints per entity in the render snapshot buffer. */
export const SNAPSHOT_STRIDE = 9;
export const SNAPSHOT_HEADER = 2;

/** Snapshot flag bits. */
export const FLAG_MOVING = 1;
export const FLAG_BUILDING = 2;
export const FLAG_NODE = 4;
export const FLAG_HERO = 8;
export const FLAG_CARRYING = 16;
export const FLAG_IDLE_WORKER = 32;
