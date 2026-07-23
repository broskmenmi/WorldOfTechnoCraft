// Per-kind building & node silhouettes: every structure gets a recognizable
// shape plus an emissive "sign" glow in a kind-specific color, replacing the
// identical team-colored boxes. Same merged-primitive thin-instance pattern
// as render/units.ts — one body batch + one glow batch per kind on screen.

import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { BUILDINGS, NODES } from '@wotc/data';
import type { UnitView } from '../simHost.ts';

const TEAM_COLORS: ReadonlyArray<[number, number, number]> = [
  [0.35, 1.0, 0.55],
  [1.0, 0.3, 0.75],
  [0.78, 0.75, 0.65],
  [1.0, 0.8, 0.25],
];

interface Part {
  shape: 'box' | 'cyl' | 'sphere';
  size: [number, number, number];
  pos: [number, number, number];
  /** Euler rotation (x, y, z) in radians. */
  rot?: [number, number, number];
}

interface Silhouette {
  body: Part[];
  /** Emissive glow parts (the sign / neon / light). */
  glow: Part[];
  glowColor: [number, number, number];
}

const B = BUILDINGS;
const T = Math.PI / 4;

/** Structure shapes. Sizes in cells; origin = footprint center on the floor. */
const SHAPES: Record<number, Silhouette> = {
  // The Door: slab + doorway arch + rope posts. The glow is the door itself.
  [B.the_door.id]: {
    body: [
      { shape: 'box', size: [3.6, 2.4, 3.2], pos: [0, 1.2, -0.2] },
      { shape: 'box', size: [0.4, 2.2, 0.4], pos: [-1.0, 1.1, 1.7] },
      { shape: 'box', size: [0.4, 2.2, 0.4], pos: [1.0, 1.1, 1.7] },
      { shape: 'box', size: [2.6, 0.4, 0.5], pos: [0, 2.4, 1.7] },
      { shape: 'cyl', size: [0.14, 1.0, 0.14], pos: [-1.7, 0.5, 1.9] },
      { shape: 'cyl', size: [0.14, 1.0, 0.14], pos: [1.7, 0.5, 1.9] },
    ],
    glow: [{ shape: 'box', size: [1.5, 1.8, 0.12], pos: [0, 0.95, 1.62] }],
    glowColor: [0.5, 1.0, 0.6],
  },
  [B.proper_venue.id]: {
    body: [
      { shape: 'box', size: [3.7, 3.0, 3.4], pos: [0, 1.5, 0] },
      { shape: 'box', size: [2.4, 0.3, 1.4], pos: [0, 2.2, 1.6] }, // awning
      { shape: 'box', size: [1.0, 1.6, 1.0], pos: [1.2, 3.7, -0.8] }, // vent tower
    ],
    glow: [{ shape: 'box', size: [2.8, 0.5, 0.12], pos: [0, 2.75, 1.72] }],
    glowColor: [0.5, 1.0, 0.6],
  },
  [B.institution.id]: {
    body: [
      { shape: 'box', size: [3.8, 3.4, 3.2], pos: [0, 1.7, -0.2] },
      { shape: 'cyl', size: [0.34, 2.6, 0.34], pos: [-1.3, 1.3, 1.5] },
      { shape: 'cyl', size: [0.34, 2.6, 0.34], pos: [-0.44, 1.3, 1.5] },
      { shape: 'cyl', size: [0.34, 2.6, 0.34], pos: [0.44, 1.3, 1.5] },
      { shape: 'cyl', size: [0.34, 2.6, 0.34], pos: [1.3, 1.3, 1.5] },
      { shape: 'box', size: [3.9, 0.6, 1.0], pos: [0, 2.9, 1.4] }, // pediment
    ],
    glow: [{ shape: 'box', size: [3.2, 0.4, 0.12], pos: [0, 3.5, 1.4] }],
    glowColor: [0.7, 0.9, 1.0],
  },
  // Monitor stack: wedge monitors piled into a pyramid.
  [B.monitor_stack.id]: {
    body: [
      { shape: 'box', size: [1.7, 0.7, 1.2], pos: [0, 0.35, 0] },
      { shape: 'box', size: [1.2, 0.6, 0.9], pos: [0, 0.95, 0], rot: [0, 0.2, 0] },
      { shape: 'box', size: [0.8, 0.5, 0.7], pos: [0, 1.5, 0], rot: [0, -0.3, 0] },
    ],
    glow: [{ shape: 'box', size: [0.5, 0.14, 0.5], pos: [0, 1.85, 0] }],
    glowColor: [0.3, 0.9, 1.0],
  },
  // Booth: desk + raised deck slab, CDJ pucks glowing.
  [B.booth.id]: {
    body: [
      { shape: 'box', size: [2.6, 1.0, 2.2], pos: [0, 0.5, 0] },
      { shape: 'box', size: [2.2, 0.5, 1.0], pos: [0, 1.25, 0.5] },
      { shape: 'box', size: [0.8, 1.8, 0.8], pos: [-0.8, 0.9, -0.7] }, // record shelf
    ],
    glow: [
      { shape: 'cyl', size: [0.5, 0.1, 0.5], pos: [-0.55, 1.55, 0.5] },
      { shape: 'cyl', size: [0.5, 0.1, 0.5], pos: [0.55, 1.55, 0.5] },
    ],
    glowColor: [0.75, 0.45, 1.0],
  },
  // Speaker stack: a tower of cones.
  [B.speaker_stack.id]: {
    body: [
      { shape: 'box', size: [1.6, 1.0, 1.3], pos: [0, 0.5, 0] },
      { shape: 'box', size: [1.3, 0.9, 1.1], pos: [0, 1.45, 0] },
      { shape: 'box', size: [1.0, 0.8, 0.9], pos: [0, 2.3, 0] },
    ],
    glow: [
      { shape: 'cyl', size: [0.6, 0.1, 0.6], pos: [0, 0.6, 0.66], rot: [Math.PI / 2, 0, 0] },
      { shape: 'cyl', size: [0.45, 0.1, 0.45], pos: [0, 1.5, 0.56], rot: [Math.PI / 2, 0, 0] },
      { shape: 'cyl', size: [0.32, 0.1, 0.32], pos: [0, 2.35, 0.46], rot: [Math.PI / 2, 0, 0] },
    ],
    glowColor: [1.0, 0.6, 0.2],
  },
  // Smoke machine: squat box, chimney, nozzle.
  [B.smoke_machine.id]: {
    body: [
      { shape: 'box', size: [1.6, 0.9, 1.4], pos: [0, 0.45, 0] },
      { shape: 'cyl', size: [0.5, 1.6, 0.5], pos: [-0.4, 1.2, -0.3] },
      { shape: 'cyl', size: [0.3, 0.9, 0.3], pos: [0.4, 0.9, 0.4], rot: [0.9, 0, 0] },
    ],
    glow: [{ shape: 'sphere', size: [0.5, 0.5, 0.5], pos: [-0.4, 2.1, -0.3] }],
    glowColor: [0.7, 0.8, 0.9],
  },
  // Warcamp: scaffolding + slanted planks + a barrel fire.
  [B.warcamp.id]: {
    body: [
      { shape: 'box', size: [3.4, 1.6, 3.0], pos: [0, 0.8, 0] },
      { shape: 'cyl', size: [0.2, 3.2, 0.2], pos: [-1.5, 1.6, -1.3] },
      { shape: 'cyl', size: [0.2, 3.2, 0.2], pos: [1.5, 1.6, -1.3] },
      { shape: 'cyl', size: [0.2, 3.2, 0.2], pos: [-1.5, 1.6, 1.3] },
      { shape: 'cyl', size: [0.2, 3.2, 0.2], pos: [1.5, 1.6, 1.3] },
      { shape: 'box', size: [3.8, 0.2, 3.4], pos: [0, 3.1, 0], rot: [0, 0, 0.08] },
      { shape: 'cyl', size: [0.6, 0.9, 0.6], pos: [1.6, 0.45, 1.8] }, // the barrel
    ],
    glow: [{ shape: 'sphere', size: [0.5, 0.5, 0.5], pos: [1.6, 1.0, 1.8] }],
    glowColor: [1.0, 0.45, 0.15],
  },
  [B.hangar.id]: {
    body: [
      { shape: 'box', size: [3.8, 2.2, 3.4], pos: [0, 1.1, 0] },
      { shape: 'cyl', size: [3.4, 3.8, 3.4], pos: [0, 2.2, 0], rot: [0, 0, Math.PI / 2] }, // barrel roof
    ],
    glow: [{ shape: 'box', size: [2.6, 0.5, 0.12], pos: [0, 1.6, 1.72] }],
    glowColor: [1.0, 0.35, 0.3],
  },
  [B.energiehal.id]: {
    body: [
      { shape: 'box', size: [3.9, 3.2, 3.5], pos: [0, 1.6, 0] },
      { shape: 'box', size: [4.1, 0.6, 1.2], pos: [0, 3.5, 0], rot: [0, 0, 0] },
      { shape: 'box', size: [0.5, 4.4, 0.5], pos: [1.6, 2.2, -1.4] }, // mast
    ],
    glow: [
      { shape: 'box', size: [3.4, 0.4, 0.12], pos: [0, 2.9, 1.78] },
      { shape: 'sphere', size: [0.4, 0.4, 0.4], pos: [1.6, 4.5, -1.4] },
    ],
    glowColor: [1.0, 0.25, 0.2],
  },
  // Generator: diesel drum + exhausts.
  [B.generator.id]: {
    body: [
      { shape: 'cyl', size: [1.5, 1.4, 1.5], pos: [0, 0.7, 0] },
      { shape: 'cyl', size: [0.25, 1.2, 0.25], pos: [0.5, 1.8, 0.3] },
      { shape: 'cyl', size: [0.25, 0.9, 0.25], pos: [-0.4, 1.7, -0.3] },
      { shape: 'box', size: [1.8, 0.3, 1.0], pos: [0, 0.15, 0] },
    ],
    glow: [{ shape: 'box', size: [0.5, 0.3, 0.1], pos: [0, 0.9, 0.78] }],
    glowColor: [1.0, 0.85, 0.25],
  },
  // Terror tent: an A-frame of two leaning slabs.
  [B.tent.id]: {
    body: [
      { shape: 'box', size: [2.8, 0.24, 2.6], pos: [-0.75, 1.05, 0], rot: [0, 0, T] },
      { shape: 'box', size: [2.8, 0.24, 2.6], pos: [0.75, 1.05, 0], rot: [0, 0, -T] },
      { shape: 'box', size: [0.3, 1.2, 0.3], pos: [0, 0.6, -1.1] },
      { shape: 'box', size: [0.3, 1.2, 0.3], pos: [0, 0.6, 1.1] },
    ],
    glow: [{ shape: 'box', size: [1.0, 0.5, 0.12], pos: [0, 0.6, 1.32] }],
    glowColor: [1.0, 0.3, 0.75],
  },
  // The Queue (cash node): a velvet-rope line of tiny hopefuls.
  [NODES.queue.id]: {
    body: [
      { shape: 'box', size: [0.34, 0.62, 0.26], pos: [-0.6, 0.31, 0.4] },
      { shape: 'box', size: [0.34, 0.55, 0.26], pos: [0.05, 0.28, 0.15] },
      { shape: 'box', size: [0.34, 0.6, 0.26], pos: [0.65, 0.3, -0.12] },
      { shape: 'sphere', size: [0.24, 0.24, 0.24], pos: [-0.6, 0.72, 0.4] },
      { shape: 'sphere', size: [0.24, 0.24, 0.24], pos: [0.05, 0.66, 0.15] },
      { shape: 'sphere', size: [0.24, 0.24, 0.24], pos: [0.65, 0.7, -0.12] },
      { shape: 'cyl', size: [0.1, 0.9, 0.1], pos: [-1.0, 0.45, -0.5] },
      { shape: 'cyl', size: [0.1, 0.9, 0.1], pos: [1.0, 0.45, -0.9] },
    ],
    glow: [{ shape: 'box', size: [2.0, 0.06, 0.06], pos: [0, 0.85, -0.7], rot: [0, 0.2, 0] }],
    glowColor: [1.0, 0.85, 0.3],
  },
  // Gear crates: a stack of road cases.
  [NODES.gear_crate.id]: {
    body: [
      { shape: 'box', size: [1.5, 0.7, 1.1], pos: [0, 0.35, 0] },
      { shape: 'box', size: [1.1, 0.6, 0.9], pos: [0.1, 1.0, -0.05], rot: [0, 0.3, 0] },
    ],
    glow: [{ shape: 'box', size: [0.4, 0.12, 0.12], pos: [0.1, 1.35, 0.3] }],
    glowColor: [0.85, 0.6, 0.3],
  },
};

interface Batch {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  capacity: number;
  count: number;
}

export class BuildingRenderer {
  private bodies = new Map<number, Batch>();
  private glows = new Map<number, Batch>();
  private fallback: Batch;

  constructor(private scene: Scene) {
    for (const [kindStr, s] of Object.entries(SHAPES)) {
      const kind = Number(kindStr);
      this.bodies.set(kind, this.makeBatch(`bld-${kind}`, s.body, null));
      if (s.glow.length > 0) this.glows.set(kind, this.makeBatch(`bld-${kind}-glow`, s.glow, s.glowColor));
    }
    this.fallback = this.makeBatch('bld-fallback', [{ shape: 'box', size: [1.8, 2.4, 1.8], pos: [0, 1.2, 0] }], null);
  }

  private makeBatch(name: string, parts: Part[], glowColor: [number, number, number] | null): Batch {
    const meshes: Mesh[] = parts.map((p, i) => {
      let m: Mesh;
      if (p.shape === 'box') {
        m = MeshBuilder.CreateBox(`${name}-${i}`, { width: p.size[0], height: p.size[1], depth: p.size[2] }, this.scene);
      } else if (p.shape === 'cyl') {
        m = MeshBuilder.CreateCylinder(`${name}-${i}`, { diameter: p.size[0], height: p.size[1], tessellation: 12 }, this.scene);
      } else {
        m = MeshBuilder.CreateSphere(`${name}-${i}`, { diameter: p.size[0], segments: 6 }, this.scene);
      }
      if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      m.position.set(p.pos[0], p.pos[1], p.pos[2]);
      return m;
    });
    const merged = Mesh.MergeMeshes(meshes, true, true)!;
    merged.name = name;
    const mat = new StandardMaterial(`${name}-mat`, this.scene);
    mat.specularColor = Color3.Black();
    if (glowColor) {
      mat.emissiveColor = new Color3(glowColor[0], glowColor[1], glowColor[2]);
      mat.disableLighting = true;
    } else {
      mat.emissiveColor = new Color3(0.1, 0.1, 0.13);
    }
    merged.material = mat;
    merged.isPickable = false;
    merged.thinInstanceRegisterAttribute('color', 4);
    merged.setEnabled(false);
    return { mesh: merged, matrices: new Float32Array(0), colors: new Float32Array(0), capacity: 0, count: 0 };
  }

  private push(batch: Batch, m: Matrix, r: number, g: number, b: number): void {
    if (batch.count + 1 > batch.capacity) {
      batch.capacity = Math.max(16, (batch.count + 1) * 2);
      const nm = new Float32Array(batch.capacity * 16);
      nm.set(batch.matrices.subarray(0, batch.count * 16));
      batch.matrices = nm;
      const nc = new Float32Array(batch.capacity * 4);
      nc.set(batch.colors.subarray(0, batch.count * 4));
      batch.colors = nc;
    }
    m.copyToArray(batch.matrices, batch.count * 16);
    batch.colors[batch.count * 4] = r;
    batch.colors[batch.count * 4 + 1] = g;
    batch.colors[batch.count * 4 + 2] = b;
    batch.colors[batch.count * 4 + 3] = 1;
    batch.count++;
  }

  private flush(batch: Batch): void {
    if (batch.count > 0) {
      batch.mesh.setEnabled(true);
      batch.mesh.thinInstanceSetBuffer('matrix', batch.matrices.subarray(0, batch.count * 16), 16, false);
      batch.mesh.thinInstanceSetBuffer('color', batch.colors.subarray(0, batch.count * 4), 4, false);
      batch.mesh.thinInstanceCount = batch.count;
    } else {
      batch.mesh.setEnabled(false);
    }
    batch.count = 0;
  }

  /** Draw all building/node views (already fog-filtered by the caller). */
  update(views: UnitView[]): void {
    const tmp = new Matrix();
    // Shapes are authored with the "front" at +z; the RTS camera sits south
    // of its target looking north, so yaw everything 180° to face it.
    const q = new Quaternion(0, 1, 0, 0);
    const scale = new Vector3();
    const trans = new Vector3();

    for (const u of views) {
      if (!u.building && !u.node) continue;
      const body = this.bodies.get(u.kind) ?? this.fallback;
      const glow = this.glows.get(u.kind);

      // Nodes settle as reserves deplete; buildings rise while constructed.
      let s = 1;
      let underConstruction = false;
      if (u.node) s = 0.55 + (0.45 * u.progress) / 100;
      else if (u.building && u.progress < 100) {
        s = 0.35 + (0.65 * u.progress) / 100;
        underConstruction = true;
      }
      scale.set(1, s, 1);
      trans.set(u.x, 0, u.y);
      Matrix.ComposeToRef(scale, q, trans, tmp);

      let [r, g, b] = TEAM_COLORS[u.player % TEAM_COLORS.length]!;
      if (u.node) {
        r = 0.8;
        g = 0.75;
        b = 0.68;
      }
      if (underConstruction) {
        // Scaffold tint: everything reads amber until it's real.
        r = 0.95;
        g = 0.65;
        b = 0.25;
      }
      const dim = underConstruction ? 0.6 : 0.9;
      this.push(body, tmp, r * dim, g * dim, b * dim);
      if (glow && !underConstruction) this.push(glow, tmp, 1, 1, 1);
    }

    for (const batch of this.bodies.values()) this.flush(batch);
    for (const batch of this.glows.values()) this.flush(batch);
    this.flush(this.fallback);
  }
}
