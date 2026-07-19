import { describe, expect, it } from 'vitest';
import * as data from '../src/index.ts';

/** Recursively assert every numeric leaf in exported data is an integer. */
function assertIntegerLeaves(value: unknown, path: string): void {
  if (typeof value === 'number') {
    expect(Number.isInteger(value), `${path} must be an integer (got ${value})`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertIntegerLeaves(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertIntegerLeaves(v, `${path}.${k}`);
  }
}

describe('data package determinism', () => {
  it('every numeric leaf in every export is an integer', () => {
    for (const [name, value] of Object.entries(data)) {
      assertIntegerLeaves(value, name);
    }
  });
});
