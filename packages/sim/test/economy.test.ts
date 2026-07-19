import { describe, expect, it } from 'vitest';
import { BUILDINGS, NODES, UNITS } from '@wotc/data';
import { commandsByTick, type Command } from '../src/commands.ts';
import { FP } from '../src/fp.ts';
import { isWalkable } from '../src/map/grid.ts';
import { deserializeSim, serializeSim } from '../src/snapshot.ts';
import { checksum, step } from '../src/step.ts';
import {
  createSim,
  hasComponent,
  headroom,
  isAlive,
  spawnBuilding,
  spawnNode,
  spawnUnit,
  tierOf,
  type SimWorld,
} from '../src/world.ts';

function run(sim: SimWorld, commands: Command[], ticks: number): void {
  const byTick = commandsByTick(commands);
  const end = sim.tick + ticks;
  while (sim.tick < end) step(sim, byTick.get(sim.tick) ?? []);
}

describe('harvest economy', () => {
  it('workers cycle node → depot and deliver cash', () => {
    const sim = createSim(1);
    spawnBuilding(sim, 0, BUILDINGS.the_door.id, 50, 50, true);
    const node = spawnNode(sim, NODES.queue.id, 60, 52);
    const w1 = spawnUnit(sim, 0, UNITS.clubgoer.id, 55 * FP, 52 * FP);
    const w2 = spawnUnit(sim, 0, UNITS.clubgoer.id, 56 * FP, 53 * FP);
    run(
      sim,
      [{ tick: 0, playerId: 0, type: 'harvest', unitIds: [w1, w2], nodeId: node }],
      60 * 20,
    );
    // Two workers, short walk: expect several deliveries of 10 cash each.
    expect(sim.cash[0]).toBeGreaterThanOrEqual(60);
    const { ResourceNode } = sim.c;
    expect(ResourceNode.remaining[node]).toBe(NODES.queue.reserve - sim.cash[0]! - (sim.c.Harvester.carry[w1]! + sim.c.Harvester.carry[w2]!));
  });

  it('gear crates deplete and vanish, freeing the map', () => {
    const sim = createSim(2);
    spawnBuilding(sim, 0, BUILDINGS.the_door.id, 50, 50, true);
    const crate = spawnNode(sim, NODES.gear_crate.id, 58, 52);
    expect(isWalkable(sim.grid, 58, 52)).toBe(false);
    const w = spawnUnit(sim, 0, UNITS.clubgoer.id, 56 * FP, 52 * FP);
    run(sim, [{ tick: 0, playerId: 0, type: 'harvest', unitIds: [w], nodeId: crate }], 3600);
    expect(sim.gear[0]).toBeGreaterThanOrEqual(NODES.gear_crate.reserve);
    expect(isAlive(sim, crate)).toBe(false);
    expect(isWalkable(sim.grid, 58, 52)).toBe(true);
  });

  it('headroom blocks training beyond the cap', () => {
    const sim = createSim(3);
    const hq = spawnBuilding(sim, 0, BUILDINGS.the_door.id, 50, 50, true);
    const cap = BUILDINGS.the_door.headroomProvided;
    sim.cash[0] = 10000;
    // Clubgoers cost 1 headroom each → exactly `cap` total should ever exist.
    const cmds: Command[] = [];
    for (let t = 0; t < cap + 20; t++) {
      cmds.push({ tick: t * 260, playerId: 0, type: 'train', buildingId: hq, kind: UNITS.clubgoer.id });
    }
    run(sim, cmds, (cap + 20) * 260 + 400);
    const hr = headroom(sim, 0);
    expect(hr.cap).toBe(cap);
    expect(hr.used).toBe(cap);
  });

  it('tier gating: monk needs tier 2; HQ upgrade unlocks it', () => {
    const sim = createSim(4);
    const hq = spawnBuilding(sim, 0, BUILDINGS.the_door.id, 50, 50, true);
    const booth = spawnBuilding(sim, 0, BUILDINGS.booth.id, 60, 50, true);
    spawnBuilding(sim, 0, BUILDINGS.monitor_stack.id, 66, 50, true);
    sim.cash[0] = 5000;
    sim.gear[0] = 2000;
    expect(tierOf(sim, 0)).toBe(1);

    // Try to train a tier-2 unit at tier 1: rejected.
    run(sim, [{ tick: 0, playerId: 0, type: 'train', buildingId: booth, kind: UNITS.front_left_monk.id }], 5);
    expect(sim.c.Building.prodKind[booth]).toBe(-1);

    // Upgrade the HQ, wait it out, then train.
    run(sim, [{ tick: 5, playerId: 0, type: 'upgrade', buildingId: hq }], BUILDINGS.the_door.upgradeTime + 40);
    expect(tierOf(sim, 0)).toBe(2);
    expect(sim.c.Building.kindId[hq]).toBe(BUILDINGS.proper_venue.id);
    run(sim, [{ tick: sim.tick, playerId: 0, type: 'train', buildingId: booth, kind: UNITS.front_left_monk.id }], 5);
    expect(sim.c.Building.prodKind[booth]).toBe(UNITS.front_left_monk.id);
  });

  it('economy state round-trips through snapshots deterministically', () => {
    const mk = (): Command[] => [{ tick: 0, playerId: 0, type: 'setup' }];
    const straight = createSim(9, { mapId: 'skirmish02' });
    run(straight, mk(), 2400);

    const paused = createSim(9, { mapId: 'skirmish02' });
    run(paused, mk(), 1200);
    const resumed = deserializeSim(serializeSim(paused));
    run(resumed, [], 1200);
    expect(checksum(resumed)).toBe(checksum(straight));
    // The economy actually ran: someone earned cash above start.
    expect(straight.cash[0]! + straight.cash[1]!).toBeGreaterThan(1000);
  });

  it('nodes render as blocked footprints', () => {
    const sim = createSim(5);
    spawnNode(sim, NODES.queue.id, 100, 100);
    expect(isWalkable(sim.grid, 100, 100)).toBe(false);
    expect(isWalkable(sim.grid, 101, 101)).toBe(false);
    expect(hasComponent(sim.world, sim.allocated, sim.c.ResourceNode)).toBe(true);
  });
});
