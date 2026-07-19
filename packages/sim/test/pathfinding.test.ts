import { describe, expect, it } from 'vitest';
import { commandsByTick, type Command } from '../src/commands.ts';
import { FP } from '../src/fp.ts';
import { isWalkable, toCell } from '../src/map/grid.ts';
import { buildFlowField } from '../src/path/flowfield.ts';
import { checksum, step } from '../src/step.ts';
import { buildMap, createSim, isAlive, type SimWorld } from '../src/world.ts';

function run(sim: SimWorld, commands: Command[], ticks: number): void {
  const byTick = commandsByTick(commands);
  const end = sim.tick + ticks;
  while (sim.tick < end) step(sim, byTick.get(sim.tick) ?? []);
}

describe('flow fields', () => {
  it('directions lead to the target from anywhere reachable', () => {
    const grid = buildMap('skirmish01');
    const field = buildFlowField(grid, 128, 200);
    // Walk the field greedily from the north floor; must reach the target
    // cell (through the door) in a bounded number of steps.
    let cx = 50;
    let cy = 50;
    for (let i = 0; i < 2000; i++) {
      if (cx === 128 && cy === 200) break;
      const ci = cx + cy * grid.w;
      const dx = field.dx[ci]!;
      const dy = field.dy[ci]!;
      expect(dx !== 0 || dy !== 0, `dead flow cell at ${cx},${cy}`).toBe(true);
      cx += dx;
      cy += dy;
      expect(isWalkable(grid, cx, cy)).toBe(true);
    }
    expect([cx, cy]).toEqual([128, 200]);
  });

  it('never directs into blocked cells', () => {
    const grid = buildMap('skirmish01');
    const field = buildFlowField(grid, 128, 200);
    for (let cy = 0; cy < grid.h; cy++) {
      for (let cx = 0; cx < grid.w; cx++) {
        const ci = cx + cy * grid.w;
        const dx = field.dx[ci]!;
        const dy = field.dy[ci]!;
        if (dx === 0 && dy === 0) continue;
        expect(isWalkable(grid, cx + dx, cy + dy)).toBe(true);
      }
    }
  });
});

describe('choke traversal', () => {
  it('200 units cross the wall through the door, deterministically', { timeout: 60000 }, () => {
    const mkCommands = (): Command[] => {
      const cmds: Command[] = [];
      const unitIds: number[] = [];
      for (let i = 0; i < 200; i++) {
        cmds.push({
          tick: 0,
          playerId: 0,
          type: 'spawn',
          kind: 1,
          x: (40 + (i % 20) * 4) * FP,
          y: (40 + Math.floor(i / 20) * 4) * FP,
        });
        unitIds.push(i + 1);
      }
      // Everyone through the door (at x≈125, wall at y≈128) to the south floor.
      cmds.push({ tick: 5, playerId: 0, type: 'move', unitIds, x: 128 * FP, y: 200 * FP });
      return cmds;
    };

    const a = createSim(99, { mapId: 'skirmish01' });
    run(a, mkCommands(), 2400); // 2 minutes of sim time

    const { Position } = a.c;
    let south = 0;
    for (let eid = 1; eid <= a.allocated; eid++) {
      if (!isAlive(a, eid)) continue;
      expect(isWalkable(a.grid, toCell(Position.x[eid]!), toCell(Position.y[eid]!))).toBe(true);
      if (Position.y[eid]! > 130 * FP) south++;
    }
    // The wall must not stop the crowd: the vast majority makes it through.
    expect(south).toBeGreaterThan(180);

    // And it's all deterministic.
    const b = createSim(99, { mapId: 'skirmish01' });
    run(b, mkCommands(), 2400);
    expect(checksum(b)).toBe(checksum(a));
  });
});
