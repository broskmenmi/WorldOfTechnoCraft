// Flow-field pathfinding (SupCom2/AoE4 style): one BFS integration per unique
// move target, then every unit following that order just reads a direction
// from its current cell. Cost is per-ORDER, not per-unit — 200 units through a
// choke share one field.
//
// Fields are pure functions of (map, target cell): deterministic, and safe to
// cache OUTSIDE the checksummed state (a rebuilt cache after snapshot restore
// yields identical directions).
//
// Full-map BFS on 256×256 is ~65k cells ≈ 1-2 ms — fine at order frequency.
// If profiling ever disagrees, the documented upgrade path is HPA* clusters
// feeding windowed flow-field tiles (see docs/TECH_STRATEGY.md).

import { idiv } from '../fp.ts';
import { cellIndex, isWalkable, type WalkGrid } from '../map/grid.ts';

export interface FlowField {
  /** Per cell: step direction toward target, each component in {-1,0,1}. */
  dx: Int8Array;
  dy: Int8Array;
}

/** 8-neighborhood in FIXED order (determinism). Diagonals last so straight
 * steps win ties in the BFS wavefront. */
const NEIGHBORS: ReadonlyArray<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

export function buildFlowField(grid: WalkGrid, targetX: number, targetY: number): FlowField {
  const n = grid.w * grid.h;
  const dist = new Int32Array(n).fill(-1);
  const dx = new Int8Array(n);
  const dy = new Int8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const start = cellIndex(grid, targetX, targetY);
  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const idx = queue[head++]!;
    const cx = idx % grid.w;
    const cy = idiv(idx - cx, grid.w);
    const d = dist[idx]!;
    for (const [nx, ny] of NEIGHBORS) {
      const ccx = cx + nx;
      const ccy = cy + ny;
      if (!isWalkable(grid, ccx, ccy)) continue;
      // No corner cutting: a diagonal step requires both cardinals open.
      if (nx !== 0 && ny !== 0 && (!isWalkable(grid, cx + nx, cy) || !isWalkable(grid, cx, cy + ny))) {
        continue;
      }
      const nidx = ccx + ccy * grid.w;
      if (dist[nidx] !== -1) continue;
      dist[nidx] = d + 1;
      // Direction points BACK toward the target (against BFS expansion).
      dx[nidx] = -nx;
      dy[nidx] = -ny;
      queue[tail++] = nidx;
    }
  }
  return { dx, dy };
}

/** Small LRU cache keyed by target cell. */
export class FlowFieldCache {
  private cache = new Map<number, FlowField>();

  constructor(
    private grid: WalkGrid,
    private capacity = 32,
  ) {}

  get(targetX: number, targetY: number): FlowField {
    const key = targetY * this.grid.w + targetX;
    const hit = this.cache.get(key);
    if (hit) {
      // refresh LRU order
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const field = buildFlowField(this.grid, targetX, targetY);
    this.cache.set(key, field);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    return field;
  }
}
