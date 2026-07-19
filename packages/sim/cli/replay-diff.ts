// Compares two checksum logs produced by cli/run.ts and reports the first
// divergent tick. Exit 0 = identical on all common ticks; exit 1 = divergence
// (a determinism bug — this is the desync repro tool).
//
//   tsx cli/replay-diff.ts /tmp/a.json /tmp/b.json

import { readFileSync } from 'node:fs';

interface ChecksumLog {
  seed: number;
  entries: Array<[number, number]>;
}

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('usage: replay-diff.ts <a.json> <b.json>');
  process.exit(64);
}

const a = JSON.parse(readFileSync(fileA, 'utf8')) as ChecksumLog;
const b = JSON.parse(readFileSync(fileB, 'utf8')) as ChecksumLog;

const mapB = new Map(b.entries);
const commonTicks = a.entries.filter(([tick]) => mapB.has(tick)).map(([tick]) => tick);

if (commonTicks.length === 0) {
  console.error('no overlapping ticks between the two logs — nothing was compared');
  process.exit(65);
}

const mapA = new Map(a.entries);
for (const tick of commonTicks) {
  const ca = mapA.get(tick)!;
  const cb = mapB.get(tick)!;
  if (ca !== cb) {
    console.error(
      `DESYNC at tick ${tick}: ${fileA}=${ca >>> 0} vs ${fileB}=${cb >>> 0} ` +
        `(first divergence after ${commonTicks.indexOf(tick)} matching checkpoints)`,
    );
    process.exit(1);
  }
}

console.log(`OK: ${commonTicks.length} common checkpoints identical (ticks ${commonTicks[0]}..${commonTicks[commonTicks.length - 1]})`);
