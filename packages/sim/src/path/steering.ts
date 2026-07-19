// Separation steering: moving units push away from nearby units so crowds
// spread instead of stacking into one pixel. Integer math, deterministic
// iteration (buckets built and scanned in ascending-eid order).

import { FP, idiv, isqrt } from '../fp.ts';
import { isAlive, type SimWorld } from '../world.ts';

/** Units closer than this (sub-units) push each other apart. */
export const SEP_RADIUS = idiv(FP * 3, 4);

/** Spatial hash of all alive units, one bucket per cell. */
export class SpatialHash {
  private buckets = new Map<number, number[]>();
  private stride: number;

  constructor(private sim: SimWorld) {
    this.stride = idiv(sim.mapW, FP) + 2;
    const { Position } = sim.c;
    for (let eid = 1; eid <= sim.allocated; eid++) {
      if (!isAlive(sim, eid)) continue;
      const key = idiv(Position.x[eid]!, FP) + idiv(Position.y[eid]!, FP) * this.stride;
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(eid);
      else this.buckets.set(key, [eid]);
    }
  }

  /**
   * Accumulated separation push for `eid` at (px,py), scaled so the strongest
   * push (fully overlapping neighbor) is about `maxPush` sub-units.
   */
  separation(eid: number, px: number, py: number, maxPush: number): [number, number] {
    const { Position } = this.sim.c;
    const cx = idiv(px, FP);
    const cy = idiv(py, FP);
    let outX = 0;
    let outY = 0;
    for (let by = cy - 1; by <= cy + 1; by++) {
      for (let bx = cx - 1; bx <= cx + 1; bx++) {
        const bucket = this.buckets.get(bx + by * this.stride);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === eid) continue;
          const dx = px - Position.x[other]!;
          const dy = py - Position.y[other]!;
          const dsq = dx * dx + dy * dy;
          if (dsq >= SEP_RADIUS * SEP_RADIUS) continue;
          if (dsq === 0) {
            // Perfectly stacked: push by eid parity so the pair separates
            // deterministically instead of both picking the same direction.
            outX += eid > other ? maxPush : -maxPush;
            continue;
          }
          const d = isqrt(dsq);
          const strength = idiv(maxPush * (SEP_RADIUS - d), SEP_RADIUS);
          outX += idiv(dx * strength, d);
          outY += idiv(dy * strength, d);
        }
      }
    }
    return [outX, outY];
  }

  /**
   * Nearest living enemy of `player` within `radius` sub-units of (px,py).
   * Deterministic: ties broken by lower eid. Re-checks aliveness because
   * combat kills happen after the hash was built.
   */
  nearestEnemy(px: number, py: number, radius: number, player: number): number {
    const { Position, Owner } = this.sim.c;
    const cx = idiv(px, FP);
    const cy = idiv(py, FP);
    const r = idiv(radius, FP) + 1;
    const radiusSq = radius * radius;
    let best = 0;
    let bestSq = radiusSq + 1;
    for (let by = cy - r; by <= cy + r; by++) {
      for (let bx = cx - r; bx <= cx + r; bx++) {
        const bucket = this.buckets.get(bx + by * this.stride);
        if (!bucket) continue;
        for (const other of bucket) {
          if (Owner.player[other] === player) continue;
          if (!isAlive(this.sim, other)) continue;
          const dx = px - Position.x[other]!;
          const dy = py - Position.y[other]!;
          const dsq = dx * dx + dy * dy;
          if (dsq < bestSq || (dsq === bestSq && other < best)) {
            bestSq = dsq;
            best = other;
          }
        }
      }
    }
    return bestSq <= radiusSq ? best : 0;
  }
}
