import { describe, expect, it } from 'vitest';
import { dist, FP, fpCos, fpSin, idiv, imod, isqrt, TURN } from '../src/fp.ts';

describe('fixed-point kit', () => {
  it('isqrt is exact on perfect squares and floors otherwise', () => {
    for (const n of [0, 1, 4, 9, 100, 1024 * 1024, 2 ** 40]) {
      expect(isqrt(n) ** 2).toBeLessThanOrEqual(n);
      expect((isqrt(n) + 1) ** 2).toBeGreaterThan(n);
    }
    expect(isqrt(15)).toBe(3);
    expect(isqrt(16)).toBe(4);
    expect(isqrt(17)).toBe(4);
    expect(() => isqrt(-1)).toThrow(RangeError);
  });

  it('idiv truncates toward zero for both signs', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(idiv(7, -2)).toBe(-3);
    expect(idiv(-7, -2)).toBe(3);
  });

  it('imod matches JS % semantics', () => {
    expect(imod(7, 3)).toBe(1);
    expect(imod(-7, 3)).toBe(-1);
  });

  it('sine table hits cardinal points exactly', () => {
    expect(fpSin(0)).toBe(0);
    expect(fpSin(TURN >> 2)).toBe(FP);
    expect(fpSin(TURN >> 1)).toBe(0);
    expect(fpSin((TURN * 3) >> 2)).toBe(-FP);
    expect(fpCos(0)).toBe(FP);
    expect(fpCos(TURN >> 1)).toBe(-FP);
  });

  it('fpSin wraps negative and oversized angles', () => {
    expect(fpSin(-(TURN >> 2))).toBe(-FP);
    expect(fpSin(TURN * 5)).toBe(fpSin(0));
    expect(fpSin(TURN + 100)).toBe(fpSin(100));
  });

  it('dist is exact for pythagorean triples', () => {
    expect(dist(0, 0, 3000, 4000)).toBe(5000);
    expect(dist(1000, 1000, 1000, 1000)).toBe(0);
  });
});
