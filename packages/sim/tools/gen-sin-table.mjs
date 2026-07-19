// Generates src/sinTable.ts as a committed literal array.
// The table is DATA, not runtime computation: Math.sin is not bit-identical
// across JS engines, so computing the table at runtime could desync lockstep
// clients. Generating once and committing the integers sidesteps that.
// Run: node tools/gen-sin-table.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TURN = 1024; // angle units per full circle
const FP = 1024; // fixed-point scale

const values = [];
for (let i = 0; i < TURN; i++) {
  values.push(Math.round(Math.sin((i / TURN) * 2 * Math.PI) * FP));
}

const rows = [];
for (let i = 0; i < values.length; i += 16) {
  rows.push('  ' + values.slice(i, i + 16).join(', ') + ',');
}

const out = `// GENERATED FILE — do not edit. Regenerate with: node tools/gen-sin-table.mjs
// sin(angle) scaled by FP=${FP}, for angles in 1/${TURN}ths of a full turn.

/** Angle units per full circle. */
export const TURN = ${TURN};

/** SIN_TABLE[a] === round(sin(a / TURN * 2π) * ${FP}) */
export const SIN_TABLE: readonly number[] = [
${rows.join('\n')}
];
`;

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, '..', 'src', 'sinTable.ts'), out);
console.log(`wrote src/sinTable.ts (${values.length} entries)`);
