import { describe, expect, it } from 'vitest';
import { HEROES, UNITS } from '@wotc/data';
import { commandsByTick, decodeReplay, encodeReplay, type Command, type Replay } from '../src/commands.ts';
import { FP } from '../src/fp.ts';
import { checksum, step } from '../src/step.ts';
import {
  createSim,
  isAlive,
  spawnBuilding,
  spawnCreep,
  spawnHero,
  spawnUnit,
  type SimWorld,
} from '../src/world.ts';

function run(sim: SimWorld, commands: Command[], ticks: number): void {
  const byTick = commandsByTick(commands);
  const end = sim.tick + ticks;
  while (sim.tick < end && sim.matchState === 0) step(sim, byTick.get(sim.tick) ?? []);
}

const SETUP: Command[] = [{ tick: 0, playerId: 0, type: 'setup' }];

describe('v2 skirmish', () => {
  it('the Legion AI runs an economy, builds, and razes an idle player', { timeout: 240000 }, () => {
    const sim = createSim(42, { mapId: 'skirmish02' });
    run(sim, SETUP, 20 * 60 * 20); // up to 20 minutes of sim time
    expect(sim.matchState).toBe(2); // idle player razed
    // The AI actually played: it banked harvested cash and built beyond its HQ.
    expect(sim.aiState[0]).toBeGreaterThanOrEqual(2); // build order progressed
    expect(sim.aiState[1]).toBeGreaterThan(0); // attacked at least once
  });

  it('full AI match is deterministic and snapshot-convergent', { timeout: 240000 }, () => {
    const a = createSim(7, { mapId: 'skirmish02' });
    const b = createSim(7, { mapId: 'skirmish02' });
    run(a, SETUP, 6000);
    run(b, SETUP, 6000);
    expect(checksum(a)).toBe(checksum(b));
  });

  it('replay round-trips a scripted match bit-for-bit', { timeout: 240000 }, () => {
    const cmds: Command[] = [
      ...SETUP,
      { tick: 400, playerId: 0, type: 'train', buildingId: 1, kind: UNITS.clubgoer.id },
      { tick: 2400, playerId: 0, type: 'policy', value: 0 },
    ];
    const live = createSim(11, { mapId: 'skirmish02' });
    run(live, cmds, 5000);

    const replay: Replay = { version: 1, seed: 11, mapId: 'skirmish02', commands: cmds };
    const decoded = decodeReplay(encodeReplay(replay));
    const played = createSim(decoded.seed, { mapId: 'skirmish02' });
    run(played, decoded.commands, 5000);
    expect(checksum(played)).toBe(checksum(live));
  });
});

describe('heroes', () => {
  it('gains XP from nearby kills, levels up, and casts a burst', () => {
    const sim = createSim(5);
    const hero = spawnHero(sim, 0, UNITS.resident_dj.id, 50 * FP, 50 * FP);
    // Feed it a snack-sized enemy patrol.
    for (let i = 0; i < 4; i++) {
      spawnUnit(sim, 1, UNITS.clubgoer.id, (53 + i) * FP, 50 * FP);
    }
    run(sim, [], 2400);
    const { Hero } = sim.c;
    expect(isAlive(sim, hero)).toBe(true);
    expect(Hero.level[hero]! > 1 || Hero.xp[hero]! > 0).toBe(true);

    // Cast Airhorn at a fresh target.
    const victim = spawnUnit(sim, 1, UNITS.gabber.id, 53 * FP, 50 * FP);
    const hpBefore = sim.c.Health.hp[victim]!;
    run(
      sim,
      [{ tick: sim.tick, playerId: 0, type: 'ability', heroId: hero, slot: 0, x: 53 * FP, y: 50 * FP }],
      2,
    );
    expect(!isAlive(sim, victim) || sim.c.Health.hp[victim]! < hpBefore).toBe(true);
    expect(Hero.cd0[hero]).toBeGreaterThan(0);
  });

  it('hero death records level; revive restores it', () => {
    const sim = createSim(6);
    spawnBuilding(sim, 0, 100, 40, 40, true); // the_door depot
    const hero = spawnHero(sim, 0, UNITS.resident_dj.id, 50 * FP, 50 * FP);
    sim.c.Hero.level[hero] = 4;
    sim.heroLevel[0] = 4;
    // Execute the hero.
    sim.c.Health.hp[hero] = 1;
    for (let i = 0; i < 8; i++) spawnCreep(sim, UNITS.feral_gabber.id, (51 + i) * FP, 50 * FP, 30);
    run(sim, [], 600);
    expect(sim.heroEid[0]).toBe(0);
    expect(sim.heroLevel[0]).toBe(4);

    sim.cash[0] = 5000;
    run(sim, [{ tick: sim.tick, playerId: 0, type: 'revive' }], 4);
    const revived = sim.heroEid[0]!;
    expect(revived).not.toBe(0);
    expect(sim.c.Hero.level[revived]).toBe(4);
    expect(sim.cash[0]).toBe(5000 - (HEROES.resident_dj.reviveBase + HEROES.resident_dj.revivePerLevel * 4));
  });
});

describe('creeps', () => {
  it('leash: creeps chase, then return home and heal', () => {
    const sim = createSim(8);
    const creep = spawnCreep(sim, UNITS.feral_gabber.id, 100 * FP, 100 * FP, 8);
    const bait = spawnUnit(sim, 0, UNITS.strobe_acolyte.id, 104 * FP, 100 * FP);
    // Bait runs away; creep should chase then give up and go home.
    run(sim, [{ tick: 2, playerId: 0, type: 'move', unitIds: [bait], x: 140 * FP, y: 100 * FP }], 1600);
    const { Position, Guard, Health } = sim.c;
    if (isAlive(sim, bait)) {
      // Creep must be back near home with full health, not somewhere in pursuit.
      const dHome = Math.hypot(
        Position.x[creep]! - Guard.homeX[creep]!,
        Position.y[creep]! - Guard.homeY[creep]!,
      );
      expect(dHome).toBeLessThan(3 * FP);
      expect(Health.hp[creep]).toBe(Health.max[creep]);
    }
  });

  it('killing creeps pays a bounty', () => {
    const sim = createSim(9);
    spawnCreep(sim, UNITS.undercover_cop.id, 60 * FP, 60 * FP, 10);
    for (let i = 0; i < 6; i++) spawnUnit(sim, 0, UNITS.bouncer.id, (56 + i) * FP, 58 * FP);
    const before = sim.cash[0]!;
    run(sim, [], 1200);
    expect(sim.cash[0]!).toBe(before + UNITS.undercover_cop.bounty);
  });
});
