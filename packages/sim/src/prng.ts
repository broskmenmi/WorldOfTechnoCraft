// mulberry32 PRNG, integer-only variant. State is a single int32 that lives in
// the world (checksummed and snapshotted like any other sim state).

export interface Prng {
  /** Current state (int32). Serialize/restore this. */
  s: number;
}

export function createPrng(seed: number): Prng {
  return { s: seed | 0 };
}

/** Next uint32 (0 .. 2^32-1). Advances state. */
export function nextU32(p: Prng): number {
  p.s = (p.s + 0x6d2b79f5) | 0;
  let t = p.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
  return (t ^ (t >>> 14)) >>> 0;
}

/**
 * Uniform-ish integer in [0, bound). Modulo bias is negligible for the small
 * bounds the sim uses (and it's deterministic, which is what matters).
 */
export function nextInt(p: Prng, bound: number): number {
  if (bound <= 0) throw new RangeError('nextInt bound must be positive');
  return nextU32(p) % bound;
}
