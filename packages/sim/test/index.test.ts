import { describe, expect, it } from 'vitest';
import { FP } from '../src/index.ts';

describe('sim package', () => {
  it('fixed-point scale is a power-of-two integer', () => {
    expect(Number.isInteger(FP)).toBe(true);
    expect(FP & (FP - 1)).toBe(0);
  });
});
