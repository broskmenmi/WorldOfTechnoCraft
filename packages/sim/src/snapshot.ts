// Exact full-state snapshot serialize/restore.
//
// Entity ids are monotonic and never recycled (see world.ts), so the only
// allocator state is the `allocated` counter. Restore recreates entities
// 0..allocated-1 in a fresh sim, re-adds component membership, then copies the
// raw component arrays wholesale — INCLUDING stale values on dead entities, so
// the restored checksum is bit-identical to the source. Public bitecs API
// only. Verified by the snapshot-convergence tests and CI.

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
export const SNAPSHOT_VERSION = 6;

const HEADER_WORDS = 10;
const AI_WORDS = 8;
const PLAYER_WORDS = 8;

export function serializeSim(sim: SimWorld): ArrayBuffer {
  const n = sim.allocated;
  let fieldCount = 0;
  for (const name of COMPONENT_NAMES) fieldCount += componentFields(sim.c[name]).length;

  const headerBytes = (HEADER_WORDS + AI_WORDS + MAX_PLAYERS * PLAYER_WORDS) * 4;
  const membershipBytes = COMPONENT_NAMES.length * n;
  const valueBytes = fieldCount * n * 4;
  const fogBytes = sim.fog.reduce((s, g) => s + g.length, 0);
  const buf = new ArrayBuffer(headerBytes + membershipBytes + valueBytes + fogBytes);
  const view = new DataView(buf);

  let o = 0;
  const put = (v: number) => {
    view.setInt32(o, v, true);
    o += 4;
  };
  view.setUint32(o, MAGIC, true);
  o += 4;
  put(SNAPSHOT_VERSION);
  put(sim.tick);
  put(sim.prng.s);
  put(n);
  put(mapIndex(sim.mapId));
  put(sim.mapW);
  put(sim.mapH);
  put(sim.raidsSpawned);
  put(sim.matchState);
  for (let i = 0; i < AI_WORDS; i++) put(sim.aiState[i]!);
  for (let p = 0; p < MAX_PLAYERS; p++) {
    put(sim.cash[p]!);
    put(sim.gear[p]!);
    put(sim.heat[p]!);
    put(sim.policy[p]!);
    put(sim.heroKind[p]!);
    put(sim.heroLevel[p]!);
    put(sim.heroXp[p]!);
    put(sim.heroEid[p]!);
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
  const minBytes = (HEADER_WORDS + AI_WORDS + MAX_PLAYERS * PLAYER_WORDS) * 4;
  if (buf.byteLength < minBytes || view.getUint32(0, true) !== MAGIC) {
    throw new Error('not a WOTC snapshot');
  }
  let o = 4;
  const get = (): number => {
    const v = view.getInt32(o, true);
    o += 4;
    return v;
  };
  const version = get();
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot version ${version} != supported ${SNAPSHOT_VERSION}`);
  }
  const tick = get();
  const prngState = get();
  const n = get();
  const mapIdx = get();
  const mapW = get();
  const mapH = get();
  const raidsSpawned = get();
  const matchState = get();
  if (n > CAPACITY) throw new Error('snapshot exceeds entity capacity');
  const mapId = MAP_IDS[mapIdx];
  if (!mapId) throw new Error(`snapshot references unknown map index ${mapIdx}`);

  const sim = createSim(0, { mapId });
  sim.tick = tick;
  sim.prng.s = prngState;
  sim.raidsSpawned = raidsSpawned;
  sim.matchState = matchState;
  if (sim.mapW !== mapW || sim.mapH !== mapH) {
    throw new Error('snapshot map size mismatch — map definition changed');
  }
  for (let i = 0; i < AI_WORDS; i++) sim.aiState[i] = get();
  for (let p = 0; p < MAX_PLAYERS; p++) {
    sim.cash[p] = get();
    sim.gear[p] = get();
    sim.heat[p] = get();
    sim.policy[p] = get();
    sim.heroKind[p] = get();
    sim.heroLevel[p] = get();
    sim.heroXp[p] = get();
    sim.heroEid[p] = get();
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
  // Buildings/nodes restored above — re-block their footprints.
  restampFootprints(sim);
  return sim;
}
