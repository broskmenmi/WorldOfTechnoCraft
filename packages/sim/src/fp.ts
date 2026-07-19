// Fixed-point math kit. Everything in the sim is integers; this file is the
// one audited place allowed to touch `/` and float-flavored operations
// (via targeted eslint-disables). All results are exact integers, so they are
// bit-identical on every JS engine — the property lockstep and replays rely on.
//
// Safe range: callers must keep |a * b| < 2^53. World coordinates are at most
// 256 cells * 1024 sub-units = 2^18, so products of two coordinates (2^36)
// and squared distances (2^37) are comfortably inside.

import { SIN_TABLE, TURN } from './sinTable.ts';

export { TURN };

/** Fixed-point scale: sub-units per world cell. */
export const FP = 1024;
export const FP_SHIFT = 10;

/** Fixed-point multiply: (a * b) / FP, truncated toward zero. */
export function fpMul(a: number, b: number): number {
  // eslint-disable-next-line no-restricted-syntax -- audited: exact double product, power-of-two divide
  return Math.trunc((a * b) / FP);
}

/** Integer division truncated toward zero (like C). */
export function idiv(a: number, b: number): number {
  // eslint-disable-next-line no-restricted-syntax -- audited: IEEE division is exact-rounded, trunc makes it integer
  return Math.trunc(a / b);
}

/** Integer modulo with the sign of the dividend (like JS %). */
export function imod(a: number, b: number): number {
  return a - idiv(a, b) * b;
}

/** Integer square root: greatest integer r with r*r <= n. Newton's method. */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError('isqrt of negative number');
  if (n < 2) return n;
  let x = n;
  let y = idiv(x + 1, 2);
  while (y < x) {
    x = y;
    y = idiv(x + idiv(n, x), 2);
  }
  return x;
}

/** sin(angle) scaled by FP, angle in 1/TURN of a full circle. */
export function fpSin(angle: number): number {
  return SIN_TABLE[imod(imod(angle, TURN) + TURN, TURN)]!;
}

/** cos(angle) scaled by FP, angle in 1/TURN of a full circle. */
export function fpCos(angle: number): number {
  return fpSin(angle + idiv(TURN, 4));
}

/** Squared Euclidean distance between two fixed-point points. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Euclidean distance (truncated to integer sub-units). */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return isqrt(distSq(ax, ay, bx, by));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
