// Resource nodes (ids 300+): The Queue is the gold mine, Gear Crates are the
// trees. Workers cycle node → depot → node.

import type { NodeDef } from './types.ts';

export const NODES = {
  queue: {
    id: 300,
    key: 'queue',
    name: 'The Queue',
    flavor: 'A finite line of people with finite money and infinite patience. Harvest respectfully.',
    kind: 'cash',
    hp: 6000,
    w: 2,
    h: 2,
    reserve: 15000,
    carry: 10,
    harvestTime: 20,
  },
  gear_crate: {
    id: 301,
    key: 'gear_crate',
    name: 'Gear Crate',
    flavor: 'Flight cases all the way down. Somewhere in the middle: one (1) working XLR.',
    kind: 'gear',
    hp: 400,
    w: 1,
    h: 1,
    reserve: 150,
    carry: 5,
    harvestTime: 30,
  },
} as const satisfies Record<string, NodeDef>;

export const NODES_BY_ID: ReadonlyMap<number, NodeDef> = new Map(
  Object.values(NODES).map((n) => [n.id, n]),
);
