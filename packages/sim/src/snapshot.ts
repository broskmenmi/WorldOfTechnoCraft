// Exact full-state snapshot serialize/restore.
//
// Entity ids are monotonic and never recycled (see world.ts), so the only
// allocator state is the `allocated` counter. Restore recreates entities
// 0..allocated-1 in a fresh sim, re-adds component membership, then copies the
// raw component arrays wholesale — INCLUDING stale values on dead entities, so
// the restored checksum is bit-identical to the source. Public bitecs API
// only. Verified by the snapshot-convergence tests and CI.
//
// Every value is stored as i32 (4 bytes) regardless of the underlying array
// type — simple, exact, and only the `allocated` prefix is stored.

import { addComponent, hasComponent } from 'bitecs';
import {
  CAPACITY,
  COMPONENT_NAMES,
  componentFields,
  createSim,
  MAP_IDS,
  mapIndex,
  MAX_PLAYERS,
  restampFootprints,
  spawnEntity,
  type SimWorld,
} from './world.ts';

const MAGIC = 0x574f5443; // 'WOTC'
export const SNAPSHOT_VERSION = 4;

export function serializeSim(sim: SimWorld): ArrayBuffer {
  const n = sim.allocated;
  let fieldCount = 0;
  for (const name of COMPONENT_NAMES) fieldCount += componentFields(sim.c[name]).length;

  const headerBytes = 9 * 4;
  const playerBytes = MAX_PLAYERS * 4 * 4; // cash, vibe, heat, policy (as i32)
  const membershipBytes = COMPONENT_NAMES.length * n;
  const valueBytes = fieldCount * n * 4;
  const fogBytes = sim.fog.reduce((s, g) => s + g.length, 0);
  const buf = new ArrayBuffer(headerBytes + playerBytes + membershipBytes + valueBytes + fogBytes);
  const view = new DataView(buf);

  let o = 0;
  view.setUint32(o, MAGIC, true);
  view.setUint32((o += 4), SNAPSHOT_VERSION, true);
  view.setInt32((o += 4), sim.tick, true);
  view.setInt32((o += 4), sim.prng.s, true);
  view.setUint32((o += 4), n, true);
  view.setUint32((o += 4), mapIndex(sim.mapId), true);
  view.setInt32((o += 4), sim.mapW, true);
  view.setInt32((o += 4), sim.mapH, true);
  view.setInt32((o += 4), sim.raidsSpawned, true);
  o += 4;
  for (let p = 0; p < MAX_PLAYERS; p++) {
    view.setInt32(o, sim.cash[p]!, true);
    view.setInt32(o + 4, sim.vibe[p]!, true);
    view.setInt32(o + 8, sim.heat[p]!, true);
    view.setInt32(o + 12, sim.policy[p]!, true);
    o += 16;
  }

  // Live ids are 1..n (bitecs reserves eid 0 as the null entity).
  for (const name of COMPONENT_NAMES) {
    const component = sim.c[name];
    for (let eid = 1; eid <= n; eid++) {
      view.setUint8(o++, hasComponent(sim.world, eid, component) ? 1 : 0);
    }
  }
  for (const name of COMPONENT_NAMES) {
    for (const [, field] of componentFields(sim.c[name])) {
      for (let eid = 1; eid <= n; eid++) {
        view.setInt32(o, field[eid]!, true);
        o += 4;
      }
    }
  }
  for (const fogGrid of sim.fog) {
    new Uint8Array(buf, o, fogGrid.length).set(fogGrid);
    o += fogGrid.length;
  }
  return buf;
}

export function deserializeSim(buf: ArrayBuffer): SimWorld {
  const view = new DataView(buf);
  if (buf.byteLength < 36 || view.getUint32(0, true) !== MAGIC) {
    throw new Error('not a WOTC snapshot');
  }
  const version = view.getUint32(4, true);
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot version ${version} != supported ${SNAPSHOT_VERSION}`);
  }
  const tick = view.getInt32(8, true);
  const prngState = view.getInt32(12, true);
  const n = view.getUint32(16, true);
  const mapIdx = view.getUint32(20, true);
  const mapW = view.getInt32(24, true);
  const mapH = view.getInt32(28, true);
  const raidsSpawned = view.getInt32(32, true);
  if (n > CAPACITY) throw new Error('snapshot exceeds entity capacity');
  const mapId = MAP_IDS[mapIdx];
  if (!mapId) throw new Error(`snapshot references unknown map index ${mapIdx}`);
  let o = 36;

  const sim = createSim(0, { mapId });
  sim.tick = tick;
  sim.prng.s = prngState;
  sim.raidsSpawned = raidsSpawned;
  if (sim.mapW !== mapW || sim.mapH !== mapH) {
    throw new Error('snapshot map size mismatch — map definition changed');
  }
  for (let p = 0; p < MAX_PLAYERS; p++) {
    sim.cash[p] = view.getInt32(o, true);
    sim.vibe[p] = view.getInt32(o + 4, true);
    sim.heat[p] = view.getInt32(o + 8, true);
    sim.policy[p] = view.getInt32(o + 12, true);
    o += 16;
  }

  // Recreate the monotonic id space (ids 1..n), then re-add membership.
  for (let i = 0; i < n; i++) spawnEntity(sim);
  for (const name of COMPONENT_NAMES) {
    const component = sim.c[name];
    for (let eid = 1; eid <= n; eid++) {
      if (view.getUint8(o++) === 1) addComponent(sim.world, eid, component);
    }
  }

  // Copy raw values last so they win over anything addComponent touched.
  for (const name of COMPONENT_NAMES) {
    for (const [, field] of componentFields(sim.c[name])) {
      for (let eid = 1; eid <= n; eid++) {
        field[eid] = view.getInt32(o, true);
        o += 4;
      }
    }
  }
  for (const fogGrid of sim.fog) {
    fogGrid.set(new Uint8Array(buf, o, fogGrid.length));
    o += fogGrid.length;
  }
  // Buildings restored above — re-block their footprints on the fresh grid.
  restampFootprints(sim);
  return sim;
}
