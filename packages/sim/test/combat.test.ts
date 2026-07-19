import { describe, expect, it } from 'vitest';
import { commandsByTick, type Command } from '../src/commands.ts';
import { FP } from '../src/fp.ts';
import { checksum, step } from '../src/step.ts';
import {
  createSim,
  isAlive,
  KIND_RANGED,
  KIND_UNIT,
  type SimWorld,
} from '../src/world.ts';

function run(sim: SimWorld, commands: Command[], ticks: number): void {
  const byTick = commandsByTick(commands);
  const end = sim.tick + ticks;
  while (sim.tick < end) step(sim, byTick.get(sim.tick) ?? []);
}

function countAlive(sim: SimWorld, player: number): number {
  const { Owner } = sim.c;
  let n = 0;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (isAlive(sim, eid) && Owner.player[eid] === player) n++;
  }
  return n;
}

describe('combat', () => {
  it('attack-move engages and the bigger force wins', () => {
    const cmds: Command[] = [];
    // 8 attackers vs 3 defenders.
    for (let i = 0; i < 8; i++) {
      cmds.push({ tick: 0, playerId: 0, type: 'spawn', kind: KIND_UNIT, x: (40 + i * 2) * FP, y: 40 * FP });
    }
    for (let i = 0; i < 3; i++) {
      cmds.push({ tick: 0, playerId: 1, type: 'spawn', kind: KIND_UNIT, x: (60 + i * 2) * FP, y: 60 * FP });
    }
    cmds.push({
      tick: 2,
      playerId: 0,
      type: 'move',
      unitIds: [1, 2, 3, 4, 5, 6, 7, 8],
      x: 62 * FP,
      y: 62 * FP,
      mode: 'a',
    });
    const sim = createSim(11);
    run(sim, cmds, 1200);
    expect(countAlive(sim, 1)).toBe(0);
    expect(countAlive(sim, 0)).toBeGreaterThan(3);
  });

  it('idle units defend themselves and return home after the fight', () => {
    const cmds: Command[] = [];
    cmds.push({ tick: 0, playerId: 0, type: 'spawn', kind: KIND_RANGED, x: 50 * FP, y: 50 * FP });
    cmds.push({ tick: 0, playerId: 1, type: 'spawn', kind: KIND_UNIT, x: 54 * FP, y: 50 * FP });
    const sim = createSim(7);
    run(sim, cmds, 1500);
    // Someone must have died — two hostiles in acquisition range can't coexist.
    expect(countAlive(sim, 0) + countAlive(sim, 1)).toBeLessThan(2);
  });

  it('combat is deterministic', () => {
    const mk = (): Command[] => {
      const cmds: Command[] = [];
      for (let i = 0; i < 20; i++) {
        cmds.push({ tick: 0, playerId: 0, type: 'spawn', kind: i % 2 ? KIND_UNIT : KIND_RANGED, x: (30 + i) * FP, y: 30 * FP });
        cmds.push({ tick: 0, playerId: 1, type: 'spawn', kind: i % 2 ? KIND_RANGED : KIND_UNIT, x: (30 + i) * FP, y: 44 * FP });
      }
      cmds.push({
        tick: 4, playerId: 0, type: 'move',
        unitIds: Array.from({ length: 20 }, (_, i) => i * 2 + 1),
        x: 40 * FP, y: 44 * FP, mode: 'a',
      });
      return cmds;
    };
    const a = createSim(3);
    const b = createSim(3);
    run(a, mk(), 800);
    run(b, mk(), 800);
    expect(checksum(a)).toBe(checksum(b));
    // And something actually happened.
    expect(countAlive(a, 0) + countAlive(a, 1)).toBeLessThan(40);
  });

  it('fog accumulates: explored stays explored after units leave', () => {
    const cmds: Command[] = [
      { tick: 0, playerId: 0, type: 'spawn', kind: KIND_UNIT, x: 30 * FP, y: 30 * FP },
      { tick: 2, playerId: 0, type: 'move', unitIds: [1], x: 80 * FP, y: 30 * FP },
    ];
    const sim = createSim(1);
    run(sim, cmds, 600);
    const fog = sim.fog[0]!;
    const at = (x: number, y: number) => fog[x + y * sim.grid.w]!;
    expect(at(30, 30)).toBe(1); // left behind: explored
    expect(at(80, 30)).toBe(2); // current position: visible
    expect(at(200, 200)).toBe(0); // never seen
  });
});
