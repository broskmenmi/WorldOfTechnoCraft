// Headless sim runner — the determinism workhorse.
//
//   tsx cli/run.ts --seed 42 --ticks 12000 --units 300 --out /tmp/a.json
//   tsx cli/run.ts --seed 42 --ticks 6000 --snapshot-out /tmp/snap.bin
//   tsx cli/run.ts --from-snapshot /tmp/snap.bin --seed 42 --ticks 6000 --out /tmp/d.json
//
// With --commands FILE it replays a recorded game; otherwise it generates a
// deterministic soak script from the seed (spawns + periodic group moves).
// Writes a checksum log: { seed, entries: [[tick, checksum], ...] }.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  CHECKSUM_INTERVAL,
  checksum,
  commandsByTick,
  createPrng,
  createSim,
  decodeReplay,
  deserializeSim,
  FP,
  nextInt,
  serializeSim,
  step,
  type Command,
  type MapId,
  type SimWorld,
} from '../src/index.ts';

/** Deterministic synthetic command script: pure function of (seed, units, ticks). */
export function generateSoak(seed: number, units: number, ticks: number): Command[] {
  const rng = createPrng(seed ^ 0x5eed);
  const cmds: Command[] = [];
  for (let i = 0; i < units; i++) {
    cmds.push({
      tick: 0,
      playerId: i % 4,
      type: 'spawn',
      kind: 0,
      x: FP * (8 + nextInt(rng, 240)),
      y: FP * (8 + nextInt(rng, 240)),
    });
  }
  for (let t = 40; t < ticks; t += 40) {
    const groupSize = 5 + nextInt(rng, 20);
    // Unit eids are 1..units (bitecs reserves eid 0).
    const start = 1 + nextInt(rng, Math.max(1, units - groupSize));
    const unitIds = Array.from({ length: groupSize }, (_, i) => start + i);
    cmds.push({
      tick: t,
      playerId: nextInt(rng, 4),
      type: nextInt(rng, 8) === 0 ? 'stop' : 'move',
      unitIds,
      x: FP * (8 + nextInt(rng, 240)),
      y: FP * (8 + nextInt(rng, 240)),
    } as Command);
  }
  return cmds;
}

const { values: args } = parseArgs({
  options: {
    map: { type: 'string', default: 'empty256' },
    seed: { type: 'string', default: '42' },
    ticks: { type: 'string', default: '2000' },
    units: { type: 'string', default: '300' },
    commands: { type: 'string' },
    out: { type: 'string' },
    'snapshot-out': { type: 'string' },
    'from-snapshot': { type: 'string' },
    'budget-mean-ms': { type: 'string' },
  },
});

const seed = Number(args.seed);
const ticks = Number(args.ticks);
const units = Number(args.units);

let sim: SimWorld;
if (args['from-snapshot']) {
  const raw = readFileSync(args['from-snapshot']);
  sim = deserializeSim(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  console.log(`resumed from snapshot at tick ${sim.tick}`);
} else {
  sim = createSim(seed, { mapId: args.map as MapId });
}

const allCommands: Command[] = args.commands
  ? decodeReplay(readFileSync(args.commands, 'utf8')).commands
  : generateSoak(seed, units, sim.tick + ticks);
const byTick = commandsByTick(allCommands);

const entries: Array<[number, number]> = [];
const endTick = sim.tick + ticks;
const t0 = performance.now();
while (sim.tick < endTick) {
  step(sim, byTick.get(sim.tick) ?? []);
  if (sim.tick % CHECKSUM_INTERVAL === 0) entries.push([sim.tick, checksum(sim)]);
}
const elapsed = performance.now() - t0;
const meanMs = elapsed / ticks;

console.log(
  `ran ${ticks} ticks (${sim.allocated} entities) in ${elapsed.toFixed(0)} ms ` +
    `(${meanMs.toFixed(3)} ms/tick), final checksum ${checksum(sim) >>> 0}`,
);

if (args.out) {
  writeFileSync(args.out, JSON.stringify({ seed, entries }));
  console.log(`wrote checksum log: ${args.out} (${entries.length} entries)`);
}
if (args['snapshot-out']) {
  writeFileSync(args['snapshot-out'], Buffer.from(serializeSim(sim)));
  console.log(`wrote snapshot at tick ${sim.tick}: ${args['snapshot-out']}`);
}
if (args['budget-mean-ms']) {
  const budget = Number(args['budget-mean-ms']);
  if (meanMs > budget) {
    console.error(`PERF BUDGET EXCEEDED: mean ${meanMs.toFixed(3)} ms/tick > ${budget} ms/tick`);
    process.exit(2);
  }
  console.log(`perf budget OK: mean ${meanMs.toFixed(3)} ms/tick <= ${budget} ms/tick`);
}
