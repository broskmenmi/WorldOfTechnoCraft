import { describe, expect, it } from 'vitest';
import { BUILDINGS, UNITS } from '@wotc/data';
import { commandsByTick, type Command } from '../src/commands.ts';
import { FP } from '../src/fp.ts';
import { isWalkable } from '../src/map/grid.ts';
import { deserializeSim, serializeSim } from '../src/snapshot.ts';
import { checksum, step } from '../src/step.ts';
import { createSim, hasComponent, isAlive, type SimWorld } from '../src/world.ts';

function run(sim: SimWorld, commands: Command[], ticks: number): void {
  const byTick = commandsByTick(commands);
  const end = sim.tick + ticks;
  while (sim.tick < end) step(sim, byTick.get(sim.tick) ?? []);
}

function aliveOf(sim: SimWorld, player: number, kindId: number): number {
  const { Owner, Kind, Building } = sim.c;
  let n = 0;
  for (let eid = 1; eid <= sim.allocated; eid++) {
    if (!isAlive(sim, eid) || Owner.player[eid] !== player) continue;
    const isB = hasComponent(sim.world, eid, Building);
    const id = isB ? Building.kindId[eid]! : Kind.id[eid]!;
    if (id === kindId) n++;
  }
  return n;
}

describe('economy', () => {
  it('bar earns cash; dancefloor earns vibe from nearby clubgoers', () => {
    const cmds: Command[] = [
      { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.bar.id, cellX: 50, cellY: 50 },
      { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.dancefloor.id, cellX: 60, cellY: 50 },
    ];
    for (let i = 0; i < 5; i++) {
      cmds.push({ tick: 0, playerId: 0, type: 'spawn', kind: UNITS.clubgoer.id, x: 62 * FP, y: 52 * FP });
    }
    const sim = createSim(1);
    run(sim, cmds, 200); // 10 seconds
    expect(sim.cash[0]).toBeGreaterThan(30); // 4/s from the bar
    expect(sim.vibe[0]).toBeGreaterThan(20); // ~5 dancers × 1/s
    expect(sim.heat[0]).toBeGreaterThan(0); // dancefloor heat
  });

  it('build command spends cash, builder constructs, footprint blocks the map', () => {
    const cmds: Command[] = [
      { tick: 0, playerId: 0, type: 'spawn', kind: UNITS.cable_guy.id, x: 52 * FP, y: 52 * FP },
      { tick: 2, playerId: 0, type: 'build', builderId: 1, kind: BUILDINGS.speaker_stack.id, cellX: 50, cellY: 50 },
    ];
    const sim = createSim(2);
    sim.cash[0] = 500;
    sim.vibe[0] = 100;
    run(sim, cmds, BUILDINGS.speaker_stack.buildTime + 200);
    expect(sim.cash[0]).toBe(500 - BUILDINGS.speaker_stack.cost.cash + Math.floor(0)); // spent, no income
    expect(aliveOf(sim, 0, BUILDINGS.speaker_stack.id)).toBe(1);
    const { Building } = sim.c;
    // Find it and confirm completion + blocked footprint.
    for (let eid = 1; eid <= sim.allocated; eid++) {
      if (isAlive(sim, eid) && hasComponent(sim.world, eid, Building)) {
        expect(Building.complete[eid]).toBe(1);
      }
    }
    expect(isWalkable(sim.grid, 50, 50)).toBe(false);
  });

  it('training queues, spends, spawns at rally; policy changes accrual', () => {
    const cmds: Command[] = [
      { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.booth.id, cellX: 50, cellY: 50 },
      { tick: 2, playerId: 0, type: 'rally', buildingId: 1, x: 70 * FP, y: 70 * FP },
      { tick: 4, playerId: 0, type: 'train', buildingId: 1, kind: UNITS.bouncer.id },
      { tick: 4, playerId: 0, type: 'train', buildingId: 1, kind: UNITS.bouncer.id },
      { tick: 6, playerId: 0, type: 'policy', value: 0 },
    ];
    const sim = createSim(3);
    sim.cash[0] = 1000;
    run(sim, cmds, UNITS.bouncer.buildTime * 2 + 300);
    expect(aliveOf(sim, 0, UNITS.bouncer.id)).toBe(2);
    expect(sim.cash[0]).toBeLessThan(1000 - 2 * UNITS.bouncer.cost.cash + 200);
    expect(sim.policy[0]).toBe(0);
    // Rally: both bouncers should have walked toward (70,70).
    const { Position, Kind } = sim.c;
    for (let eid = 1; eid <= sim.allocated; eid++) {
      if (isAlive(sim, eid) && Kind.id[eid] === UNITS.bouncer.id) {
        expect(Math.abs(Position.x[eid]! - 70 * FP)).toBeLessThan(6 * FP);
        expect(Math.abs(Position.y[eid]! - 70 * FP)).toBeLessThan(6 * FP);
      }
    }
  });

  it('heat triggers escalating raids', () => {
    const cmds: Command[] = [
      { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.the_door.id, cellX: 120, cellY: 180 },
    ];
    const sim = createSim(4, { mapId: 'skirmish01' });
    sim.heat[0] = 99;
    // Speaker heat pushes over the threshold quickly.
    cmds.push({ tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.speaker_stack.id, cellX: 110, cellY: 180 });
    run(sim, cmds, 400);
    expect(sim.raidsSpawned).toBeGreaterThanOrEqual(1);
    expect(aliveOf(sim, 1, UNITS.gabber.id)).toBeGreaterThan(0);
  });

  it('economy state round-trips through snapshots and stays deterministic', () => {
    const mk = (): Command[] => [
      { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.the_door.id, cellX: 100, cellY: 170 },
      { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.dancefloor.id, cellX: 110, cellY: 170 },
      { tick: 2, playerId: 0, type: 'train', buildingId: 1, kind: UNITS.clubgoer.id },
      { tick: 2, playerId: 0, type: 'train', buildingId: 1, kind: UNITS.cable_guy.id },
      { tick: 400, playerId: 0, type: 'build', builderId: 4, kind: BUILDINGS.bar.id, cellX: 120, cellY: 170 },
    ];
    const straight = createSim(9, { mapId: 'skirmish01' });
    straight.cash[0] = 400;
    run(straight, mk(), 1200);

    const paused = createSim(9, { mapId: 'skirmish01' });
    paused.cash[0] = 400;
    run(paused, mk(), 600);
    const resumed = deserializeSim(serializeSim(paused));
    run(resumed, mk().filter((c) => c.tick >= 600), 600);
    expect(checksum(resumed)).toBe(checksum(straight));
  });
});
