import { describe, expect, it } from 'vitest';
import { fnv1aArray, fnv1aI32, FNV_OFFSET } from '../src/hash.ts';
import { createPrng, nextInt, nextU32 } from '../src/prng.ts';

describe('mulberry32 prng', () => {
  it('is reproducible from a seed', () => {
    const a = createPrng(1337);
    const b = createPrng(1337);
    const seqA = Array.from({ length: 10 }, () => nextU32(a));
    const seqB = Array.from({ length: 10 }, () => nextU32(b));
    expect(seqA).toEqual(seqB);
  });

  it('golden sequence pins the algorithm (any change = sim version break)', () => {
    const p = createPrng(42);
    // If this test starts failing, the PRNG changed and every replay/save
    // made before the change is invalid. Bump SNAPSHOT_VERSION/REPLAY_VERSION.
    expect([nextU32(p), nextU32(p), nextU32(p)]).toEqual([2584728083, 675079005, 2044641832]);
  });

  it('produces uint32s and respects nextInt bounds', () => {
    const p = createPrng(-1);
    for (let i = 0; i < 1000; i++) {
      const v = nextU32(p);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(v)).toBe(true);
      const bounded = nextInt(p, 7);
      expect(bounded).toBeGreaterThanOrEqual(0);
      expect(bounded).toBeLessThan(7);
    }
    expect(() => nextInt(p, 0)).toThrow(RangeError);
  });
});

describe('fnv1a hash', () => {
  it('golden values pin the algorithm', () => {
    expect(fnv1aI32(FNV_OFFSET, 0)).toBe(1268118805);
    expect(fnv1aArray(FNV_OFFSET, new Int32Array([1, 2, 3]), 3)).toBe(
      fnv1aI32(fnv1aI32(fnv1aI32(FNV_OFFSET, 1), 2), 3),
    );
  });

  it('respects the length prefix', () => {
    const arr = new Int32Array([5, 6, 7, 8]);
    expect(fnv1aArray(FNV_OFFSET, arr, 2)).toBe(fnv1aArray(FNV_OFFSET, new Int32Array([5, 6]), 2));
    expect(fnv1aArray(FNV_OFFSET, arr, 2)).not.toBe(fnv1aArray(FNV_OFFSET, arr, 4));
  });
});
