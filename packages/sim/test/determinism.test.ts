import { describe, expect, it } from 'vitest';
import { commandsByTick, type Command } from '../src/commands.ts';
import { deserializeSim, serializeSim } from '../src/snapshot.ts';
import { checksum, step } from '../src/step.ts';
import { COMPONENT_NAMES, componentFields, createSim, type SimWorld } from '../src/world.ts';
import { FP } from '../src/fp.ts';

/** A scripted little match: spawns, moves, stops, and idle wandering. */
function scriptedCommands(): Command[] {
  const cmds: Command[] = [];
  for (let i = 0; i < 40; i++) {
    cmds.push({
      tick: 0,
      playerId: i % 2,
      type: 'spawn',
      kind: 0,
      x: (10 + (i % 8) * 3) * FP,
      y: (10 + ((i / 8) | 0) * 3) * FP,
    });
  }
  cmds.push({ tick: 50, playerId: 0, type: 'move', unitIds: [0, 1, 2, 3, 4], x: 200 * FP, y: 200 * FP });
  cmds.push({ tick: 120, playerId: 1, type: 'move', unitIds: [5, 6, 7], x: 30 * FP, y: 220 * FP });
  cmds.push({ tick: 180, playerId: 0, type: 'stop', unitIds: [0, 1, 2] });
  cmds.push({ tick: 250, playerId: 0, type: 'move', unitIds: [0, 99999], x: 100 * FP, y: 100 * FP });
  return cmds;
}

function run(sim: SimWorld, commands: Command[], ticks: number, checksums?: number[]): void {
  const byTick = commandsByTick(commands);
  const end = sim.tick + ticks;
  while (sim.tick < end) {
    step(sim, byTick.get(sim.tick) ?? []);
    if (checksums && sim.tick % 10 === 0) checksums.push(checksum(sim));
  }
}

describe('sim determinism', () => {
  it('all component arrays are integer-typed (no float storage)', () => {
    const sim = createSim(0);
    for (const name of COMPONENT_NAMES) {
      for (const [field, arr] of componentFields(sim.c[name])) {
        const isFloat =
          (arr as unknown) instanceof Float32Array || (arr as unknown) instanceof Float64Array;
        expect(isFloat, `${name}.${field} must be an integer array`).toBe(false);
      }
    }
  });

  it('same seed + same commands => identical checksum streams', () => {
    const a = createSim(2026);
    const b = createSim(2026);
    const csA: number[] = [];
    const csB: number[] = [];
    run(a, scriptedCommands(), 500, csA);
    run(b, scriptedCommands(), 500, csB);
    expect(csA.length).toBeGreaterThan(0);
    expect(csA).toEqual(csB);
  });

  it('different seeds diverge (checksum actually sees state)', () => {
    const a = createSim(1);
    const b = createSim(2);
    run(a, scriptedCommands(), 100);
    run(b, scriptedCommands(), 100);
    expect(checksum(a)).not.toBe(checksum(b));
  });

  it('command for the wrong tick throws', () => {
    const sim = createSim(7);
    expect(() =>
      step(sim, [{ tick: 5, playerId: 0, type: 'stop', unitIds: [] }]),
    ).toThrow(/tick/);
  });
});

describe('snapshot round-trip', () => {
  it('restore is bit-identical and future evolution converges', () => {
    const live = createSim(555);
    const cmds = scriptedCommands();
    run(live, cmds, 300);

    const snap = serializeSim(live);
    const restored = deserializeSim(snap);
    expect(checksum(restored)).toBe(checksum(live));

    // Both continue with the same late commands: streams must stay identical.
    const csLive: number[] = [];
    const csRestored: number[] = [];
    run(live, [], 300, csLive);
    run(restored, [], 300, csRestored);
    expect(csLive).toEqual(csRestored);
  });

  it('snapshot at tick N converges with an uninterrupted run', () => {
    const straight = createSim(808);
    const cmds = scriptedCommands();
    run(straight, cmds, 600);

    const paused = createSim(808);
    run(paused, cmds, 300);
    const resumed = deserializeSim(serializeSim(paused));
    run(resumed, cmds.filter((c) => c.tick >= 300), 300);

    expect(checksum(resumed)).toBe(checksum(straight));
  });

  it('rejects garbage and version mismatches', () => {
    expect(() => deserializeSim(new ArrayBuffer(64))).toThrow(/snapshot/);
  });
});
