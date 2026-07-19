// FNV-1a 32-bit, used as the desync tripwire: clients (and CI runs) hash sim
// state every few ticks and compare streams. Not cryptographic — just fast and
// deterministic.

export const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Fold one byte into a running FNV-1a hash. */
export function fnv1aByte(h: number, byte: number): number {
  return Math.imul(h ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** Fold an int32 (or uint32) into the hash, little-endian byte order. */
export function fnv1aI32(h: number, v: number): number {
  h = fnv1aByte(h, v);
  h = fnv1aByte(h, v >>> 8);
  h = fnv1aByte(h, v >>> 16);
  h = fnv1aByte(h, v >>> 24);
  return h;
}

/** Fold the first `len` elements of an integer TypedArray into the hash. */
export function fnv1aArray(
  h: number,
  arr: Int32Array | Uint32Array | Int16Array | Uint16Array | Uint8Array | Int8Array,
  len: number,
): number {
  const n = Math.min(len, arr.length);
  for (let i = 0; i < n; i++) h = fnv1aI32(h, arr[i]!);
  return h;
}
