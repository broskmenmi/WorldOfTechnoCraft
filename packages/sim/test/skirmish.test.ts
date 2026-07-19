import { describe, expect, it } from 'vitest';
import { BUILDINGS, UNITS } from '@wotc/data';
import { commandsByTick, decodeReplay, encodeReplay, type Command, type Replay } from '../src/commands.ts';
import { FP } from '../src/fp.ts';
import { checksum, step } from '../src/step.ts';
import { createSim, FIRST_WAVE_TICK, type SimWorld } from '../src/world.ts';

function run(sim: SimWorld, commands: Command[], ticks: number): void {
  const byTick = commandsByTick(commands);
  const end = sim.tick + ticks;
  while (sim.tick < end && sim.matchState === 0) step(sim, byTick.get(sim.tick) ?? []);
}

function clubSetup(): Command[] {
  return [
    { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.the_door.id, cellX: 116, cellY: 196 },
    { tick: 0, playerId: 1, type: 'spawnBuilding', kind: BUILDINGS.warcamp.id, cellX: 118, cellY: 30 },
  ];
}

describe('skirmish', () => {
  it('an undefended club falls to the Legion waves', { timeout: 60000 }, () => {
    const sim = createSim(42, { mapId: 'skirmish01', sunriseTicks: 100000 });
    run(sim, clubSetup(), 30000);
    expect(sim.matchState).toBe(2);
    expect(sim.wavesSpawned).toBeGreaterThanOrEqual(1);
  });

  it('surviving to sunrise wins, with peak vibe as the score', () => {
    const sunrise = FIRST_WAVE_TICK - 200; // dawn beats the first wave
    const sim = createSim(42, { mapId: 'skirmish01', sunriseTicks: sunrise });
    const cmds = clubSetup();
    cmds.push({ tick: 0, playerId: 0, type: 'grant', cash: 0, vibe: 77 });
    run(sim, cmds, sunrise + 100);
    expect(sim.matchState).toBe(1);
    expect(sim.peakVibe).toBeGreaterThanOrEqual(77);
  });

  it('a full match replays bit-for-bit from the encoded replay file', { timeout: 60000 }, () => {
    const cmds: Command[] = [
      ...clubSetup(),
      { tick: 0, playerId: 0, type: 'grant', cash: 500, vibe: 0 },
      { tick: 0, playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.booth.id, cellX: 104, cellY: 188 },
      { tick: 4, playerId: 0, type: 'train', buildingId: 3, kind: UNITS.bouncer.id },
      { tick: 4, playerId: 0, type: 'train', buildingId: 3, kind: UNITS.strobe_acolyte.id },
      { tick: 600, playerId: 0, type: 'move', unitIds: [4, 5], x: 120 * FP, y: 150 * FP, mode: 'a' },
    ];
    const live = createSim(7, { mapId: 'skirmish01', sunriseTicks: 5000 });
    run(live, cmds, 6000);

    const replay: Replay = { version: 1, seed: 7, mapId: 'skirmish01', commands: cmds };
    const decoded = decodeReplay(encodeReplay(replay));
    const played = createSim(decoded.seed, { mapId: 'skirmish01', sunriseTicks: 5000 });
    run(played, decoded.commands, 6000);

    expect(checksum(played)).toBe(checksum(live));
    expect(played.matchState).toBe(live.matchState);
  });
});
