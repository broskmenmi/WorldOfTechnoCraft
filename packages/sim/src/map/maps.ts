// Map registry. Maps are identified by a stable index (stored in snapshots)
// and built deterministically from code — no external data to desync on.

import { blockRect, createGrid, type WalkGrid } from './grid.ts';

export const MAP_IDS = ['empty256', 'skirmish01', 'skirmish02'] as const;
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
      // v1 test map: one wall, one door. Kept for tests/benches.
      const g = createGrid(256, 256);
      blockRect(g, 0, 0, 256, 2);
      blockRect(g, 0, 254, 256, 2);
      blockRect(g, 0, 0, 2, 256);
      blockRect(g, 254, 0, 2, 256);
      blockRect(g, 2, 126, 118, 4);
      blockRect(g, 130, 126, 124, 4);
      blockRect(g, 60, 60, 6, 6);
      blockRect(g, 180, 70, 6, 6);
      blockRect(g, 90, 190, 6, 6);
      blockRect(g, 170, 180, 6, 6);
      return g;
    }
    case 'skirmish02': {
      // v2 match map: player base SW, Legion NE, the great wall across the
      // middle with three doors (west, center — creep-guarded, east).
      const g = createGrid(256, 256);
      blockRect(g, 0, 0, 256, 2);
      blockRect(g, 0, 254, 256, 2);
      blockRect(g, 0, 0, 2, 256);
      blockRect(g, 254, 0, 2, 256);
      // The wall: y 126..130, doors at x 56..68, 122..134, 188..200.
      blockRect(g, 2, 126, 54, 4);
      blockRect(g, 68, 126, 54, 4);
      blockRect(g, 134, 126, 54, 4);
      blockRect(g, 200, 126, 54, 4);
      // Scattered pillars for texture.
      blockRect(g, 100, 60, 5, 5);
      blockRect(g, 156, 196, 5, 5);
      blockRect(g, 40, 90, 4, 4);
      blockRect(g, 216, 166, 4, 4);
      return g;
    }
  }
}

// ── Match setup tables (consumed by the sim's 'setup' command) ──────────────

export interface MatchSetup {
  /** [player, hqBuildingKind, cellX, cellY] */
  hqs: Array<[number, number, number, number]>;
  /** [player, heroUnitKind, x(cells), y(cells)] */
  heroes: Array<[number, number, number, number]>;
  /** [player, workerUnitKind, count, x(cells), y(cells)] */
  workers: Array<[number, number, number, number, number]>;
  /** [nodeKind, cellX, cellY] */
  nodes: Array<[number, number, number]>;
  /** [creepUnitKind, x(cells), y(cells)] */
  creeps: Array<[number, number, number]>;
  /** Ambient crowd (neutral wanderers): [unitKind, count, cx, cy]. */
  ambient: Array<[number, number, number, number]>;
  startCash: number;
  startGear: number;
}

import { BUILDINGS, NODES, UNITS } from '@wotc/data';

const B = BUILDINGS;
const U = UNITS;
const N = NODES;

/** Gear crate cluster helper: positions around a center. */
function crates(cx: number, cy: number): Array<[number, number, number]> {
  const offsets = [
    [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [3, 1], [1, 3], [3, 3], [2, 3],
  ];
  return offsets.map(([dx, dy]) => [N.gear_crate.id, cx + dx!, cy + dy!]);
}

export const MATCH_SETUPS: Partial<Record<MapId, MatchSetup>> = {
  skirmish02: {
    hqs: [
      [0, B.the_door.id, 48, 204],
      [1, B.warcamp.id, 204, 48],
    ],
    heroes: [
      [0, U.resident_dj.id, 55, 212],
      [1, U.kapitein_hak.id, 202, 44],
    ],
    workers: [
      [0, U.clubgoer.id, 5, 46, 200],
      [1, U.roadie.id, 5, 208, 52],
    ],
    nodes: [
      // Home Queues.
      [N.queue.id, 36, 214],
      [N.queue.id, 218, 38],
      // Expansion Queue at the center door's south side (creep-guarded).
      [N.queue.id, 126, 142],
      // Gear clusters: one per base, one contested mid-east.
      ...crates(62, 218),
      ...crates(190, 32),
      ...crates(196, 148),
    ],
    creeps: [
      // Center door camp (north side).
      [U.feral_gabber.id, 124, 118],
      [U.feral_gabber.id, 130, 118],
      [U.chief_inspector.id, 127, 114],
      // Expansion Queue camp.
      [U.undercover_cop.id, 122, 146],
      [U.undercover_cop.id, 130, 146],
      [U.undercover_cop.id, 126, 150],
      [U.undercover_cop.id, 118, 150],
      // Contested gear camp.
      [U.feral_gabber.id, 193, 154],
      [U.feral_gabber.id, 200, 156],
      [U.undercover_cop.id, 196, 158],
    ],
    ambient: [
      // The smoking-area crowd: purely decorative, endlessly vibing.
      [U.raver.id, 10, 58, 210],
      [U.raver.id, 10, 210, 58],
      [U.raver.id, 6, 126, 136],
    ],
    startCash: 500,
    startGear: 150,
  },
};
