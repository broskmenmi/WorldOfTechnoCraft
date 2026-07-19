// Commands are the sim's ONLY input. Every UI action compiles to one of these;
// the same structs are the replay format, the save format, and (later) the
// lockstep network payload. The sim never reads anything else from the outside
// world — that is what makes replays and lockstep free.

export interface SpawnCommand {
  tick: number;
  playerId: number;
  type: 'spawn';
  /** Unit kind id (index into @wotc/data unit defs; 0 = debug walker). */
  kind: number;
  /** Spawn position in fixed-point sub-units. */
  x: number;
  y: number;
}

export interface MoveCommand {
  tick: number;
  playerId: number;
  type: 'move';
  unitIds: number[];
  /** Target in fixed-point sub-units. */
  x: number;
  y: number;
  /** 'a' = attack-move. Stored now, combat behavior lands in M6. */
  mode?: 'a';
}

export interface StopCommand {
  tick: number;
  playerId: number;
  type: 'stop';
  unitIds: number[];
}

export type Command = SpawnCommand | MoveCommand | StopCommand;

/** A recorded game: everything needed to reproduce it bit-for-bit. */
export interface Replay {
  version: number;
  seed: number;
  mapId: string;
  commands: Command[];
}

export const REPLAY_VERSION = 1;

export function encodeReplay(replay: Replay): string {
  return JSON.stringify(replay);
}

export function decodeReplay(json: string): Replay {
  const r = JSON.parse(json) as Replay;
  if (r.version !== REPLAY_VERSION) {
    throw new Error(`replay version ${r.version} != supported ${REPLAY_VERSION}`);
  }
  if (!Number.isInteger(r.seed) || typeof r.mapId !== 'string' || !Array.isArray(r.commands)) {
    throw new Error('malformed replay');
  }
  let prev = 0;
  for (const c of r.commands) {
    if (!Number.isInteger(c.tick) || c.tick < prev) {
      throw new Error('replay commands must be tick-ordered');
    }
    prev = c.tick;
  }
  return r;
}

/** Group a tick-ordered command list by tick for feeding step(). */
export function commandsByTick(commands: Command[]): Map<number, Command[]> {
  const byTick = new Map<number, Command[]>();
  for (const c of commands) {
    const list = byTick.get(c.tick);
    if (list) list.push(c);
    else byTick.set(c.tick, [c]);
  }
  return byTick;
}
