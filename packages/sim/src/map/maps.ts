// Map registry. Maps are identified by a stable index (stored in snapshots)
// and built deterministically from code — no external data to desync on.

import { blockRect, createGrid, type WalkGrid } from './grid.ts';

export const MAP_IDS = ['empty256', 'skirmish01'] as const;
export type MapId = (typeof MAP_IDS)[number];

export function mapIndex(id: MapId): number {
  const i = MAP_IDS.indexOf(id);
  if (i < 0) throw new Error(`unknown map: ${id}`);
  return i;
}

export function buildMap(id: MapId): WalkGrid {
  switch (id) {
    case 'empty256':
      return createGrid(256, 256);
    case 'skirmish01': {
      // The Powerplant forecourt: open floors north and south, one wall across
      // the middle with a narrow door (the choke — naturally).
      const g = createGrid(256, 256);
      blockRect(g, 0, 0, 256, 2);
      blockRect(g, 0, 254, 256, 2);
      blockRect(g, 0, 0, 2, 256);
      blockRect(g, 254, 0, 2, 256);
      // The wall at y=126..130, with a 10-cell door at x=120..130.
      blockRect(g, 2, 126, 118, 4);
      blockRect(g, 130, 126, 124, 4);
      // Some pillars ("speaker stacks") scattered on each floor.
      blockRect(g, 60, 60, 6, 6);
      blockRect(g, 180, 70, 6, 6);
      blockRect(g, 90, 190, 6, 6);
      blockRect(g, 170, 180, 6, 6);
      return g;
    }
  }
}
