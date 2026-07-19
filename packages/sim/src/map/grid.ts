// Walkability grid: 1 byte per cell, 0 = walkable, 1 = blocked.
// Static per map — derived from the map id, so it is NOT part of
// checksums/snapshots (the map id is).

import { FP, idiv } from '../fp.ts';

export interface WalkGrid {
  w: number;
  h: number;
  cells: Uint8Array;
}

export function createGrid(w: number, h: number): WalkGrid {
  return { w, h, cells: new Uint8Array(w * h) };
}

export function cellIndex(grid: WalkGrid, cx: number, cy: number): number {
  return cy * grid.w + cx;
}

export function inBounds(grid: WalkGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < grid.w && cy < grid.h;
}

export function isWalkable(grid: WalkGrid, cx: number, cy: number): boolean {
  return inBounds(grid, cx, cy) && grid.cells[cellIndex(grid, cx, cy)] === 0;
}

export function blockRect(grid: WalkGrid, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (inBounds(grid, x, y)) grid.cells[cellIndex(grid, x, y)] = 1;
    }
  }
}

/** Sub-unit position → cell coordinate. */
export function toCell(v: number): number {
  return idiv(v, FP);
}

/**
 * Line-of-sight between two sub-unit points, sampled at half-cell intervals.
 * Conservative enough for steering (not for gameplay rules like attacks).
 */
export function losClear(grid: WalkGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) >> 9; // / (FP/2)
  for (let i = 1; i <= steps; i++) {
    const cx = toCell(x0 + idiv(dx * i, steps + 1));
    const cy = toCell(y0 + idiv(dy * i, steps + 1));
    if (!isWalkable(grid, cx, cy)) return false;
  }
  return true;
}

/**
 * Deterministic outward ring scan for the nearest walkable cell.
 * Returns [cx, cy] (the input if already walkable).
 */
export function nearestWalkable(grid: WalkGrid, cx: number, cy: number): [number, number] {
  if (isWalkable(grid, cx, cy)) return [cx, cy];
  for (let r = 1; r < Math.max(grid.w, grid.h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkable(grid, cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
    }
  }
  return [cx, cy];
}
