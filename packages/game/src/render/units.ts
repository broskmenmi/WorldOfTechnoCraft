// Per-kind unit silhouettes: each kind is a merged primitive mesh drawn as a
// thin-instance batch (one draw call per kind on screen). Facing comes from
// frame-to-frame movement; walk-bob only while moving; idle sway on the beat.
// Nobody dies in this game: units that lose the clash rage-quit — a quick
// spin, a huff, and they storm off toward the exit while fading out.

import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { UNITS } from '@wotc/data';
import type { UnitView } from '../simHost.ts';

const TEAM_COLORS: ReadonlyArray<[number, number, number]> = [
  [0.35, 1.0, 0.55],
  [1.0, 0.3, 0.75],
  [0.78, 0.75, 0.65],
  [1.0, 0.8, 0.25],
];

interface Part {
  shape: 'box' | 'cyl' | 'sphere';
  /** width, height, depth (diameter for cyl/sphere). */
  size: [number, number, number];
  /** offset x (right), y (up), z (forward). */
  pos: [number, number, number];
}

/** Silhouettes. Forward = +z. Sizes in world cells. */
const SILHOUETTES: Record<number, Part[]> = {
  // Clubgoer / worker: small, hunched, big headphones.
  [UNITS.clubgoer.id]: [
    { shape: 'box', size: [0.38, 0.55, 0.3], pos: [0, 0.28, 0] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [0, 0.68, 0.04] },
    { shape: 'box', size: [0.42, 0.1, 0.12], pos: [0, 0.72, 0.02] },
  ],
  [UNITS.roadie.id]: [
    { shape: 'box', size: [0.42, 0.5, 0.34], pos: [0, 0.25, 0] },
    { shape: 'sphere', size: [0.28, 0.28, 0.28], pos: [0, 0.64, 0.02] },
    { shape: 'box', size: [0.5, 0.14, 0.4], pos: [0, 0.1, -0.26] }, // the case he never puts down
  ],
  // Bouncer: wide slab, tiny head, arms-folded mass.
  [UNITS.bouncer.id]: [
    { shape: 'box', size: [0.72, 0.8, 0.42], pos: [0, 0.4, 0] },
    { shape: 'sphere', size: [0.26, 0.26, 0.26], pos: [0, 0.92, 0] },
    { shape: 'box', size: [0.8, 0.16, 0.3], pos: [0, 0.62, 0.14] },
  ],
  // Strobe acolyte: thin, tall staff with emissive tip.
  [UNITS.strobe_acolyte.id]: [
    { shape: 'box', size: [0.3, 0.7, 0.24], pos: [0, 0.35, 0] },
    { shape: 'sphere', size: [0.24, 0.24, 0.24], pos: [0, 0.82, 0] },
    { shape: 'cyl', size: [0.07, 1.3, 0.07], pos: [0.24, 0.65, 0] },
    { shape: 'sphere', size: [0.2, 0.2, 0.2], pos: [0.24, 1.34, 0] },
  ],
  // Front-left monk: tall hooded monolith.
  [UNITS.front_left_monk.id]: [
    { shape: 'box', size: [0.5, 1.15, 0.4], pos: [0, 0.58, 0] },
    { shape: 'box', size: [0.42, 0.3, 0.36], pos: [0, 1.2, 0.06] },
  ],
  // Bass cannon: box on wheels with a horn.
  [UNITS.bass_cannon.id]: [
    { shape: 'box', size: [0.7, 0.5, 0.9], pos: [0, 0.42, 0] },
    { shape: 'cyl', size: [0.5, 0.4, 0.5], pos: [0, 0.55, 0.55] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [-0.3, 0.16, 0.3] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [0.3, 0.16, 0.3] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [-0.3, 0.16, -0.3] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [0.3, 0.16, -0.3] },
  ],
  // Gabber: lean, tilted forward, mid-hak.
  [UNITS.gabber.id]: [
    { shape: 'box', size: [0.34, 0.6, 0.3], pos: [0, 0.34, 0.08] },
    { shape: 'sphere', size: [0.26, 0.26, 0.26], pos: [0, 0.72, 0.16] },
    { shape: 'box', size: [0.14, 0.34, 0.14], pos: [-0.12, 0.06, -0.14] },
    { shape: 'box', size: [0.14, 0.34, 0.14], pos: [0.14, 0.1, 0.18] },
  ],
  // Bruiser: hulk.
  [UNITS.hakken_bruiser.id]: [
    { shape: 'box', size: [0.85, 0.9, 0.55], pos: [0, 0.48, 0] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [0, 1.06, 0.06] },
    { shape: 'box', size: [0.24, 0.6, 0.24], pos: [-0.5, 0.42, 0] },
    { shape: 'box', size: [0.24, 0.6, 0.24], pos: [0.5, 0.42, 0] },
  ],
  // Screamer: cone-mouthed yeller.
  [UNITS.uptempo_screamer.id]: [
    { shape: 'box', size: [0.4, 0.65, 0.32], pos: [0, 0.34, 0] },
    { shape: 'sphere', size: [0.26, 0.26, 0.26], pos: [0, 0.78, 0.02] },
    { shape: 'cyl', size: [0.34, 0.4, 0.34], pos: [0, 0.78, 0.32] },
  ],
  // Resident DJ: deck slab + headphones, faint hover.
  [UNITS.resident_dj.id]: [
    { shape: 'box', size: [0.44, 0.75, 0.34], pos: [0, 0.4, 0] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [0, 0.9, 0] },
    { shape: 'box', size: [0.5, 0.12, 0.16], pos: [0, 0.94, 0] },
    { shape: 'box', size: [0.8, 0.1, 0.5], pos: [0, 0.62, 0.3] },
    { shape: 'cyl', size: [0.16, 0.02, 0.16], pos: [-0.2, 0.68, 0.3] },
    { shape: 'cyl', size: [0.16, 0.02, 0.16], pos: [0.2, 0.68, 0.3] },
  ],
  // Kapitein Hak: broad, gold-trim crown block.
  [UNITS.kapitein_hak.id]: [
    { shape: 'box', size: [0.7, 0.85, 0.5], pos: [0, 0.45, 0] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [0, 1.0, 0.04] },
    { shape: 'box', size: [0.4, 0.12, 0.4], pos: [0, 1.18, 0.04] },
    { shape: 'box', size: [0.2, 0.5, 0.2], pos: [-0.44, 0.4, 0.06] },
    { shape: 'box', size: [0.2, 0.5, 0.2], pos: [0.44, 0.4, 0.06] },
  ],
  // Creeps.
  [UNITS.undercover_cop.id]: [
    { shape: 'box', size: [0.42, 0.68, 0.3], pos: [0, 0.36, 0] },
    { shape: 'sphere', size: [0.26, 0.26, 0.26], pos: [0, 0.82, 0] },
    { shape: 'box', size: [0.5, 0.06, 0.34], pos: [0, 0.7, 0] }, // the lanyard shelf
  ],
  [UNITS.feral_gabber.id]: [
    { shape: 'box', size: [0.36, 0.55, 0.3], pos: [0, 0.3, 0.1] },
    { shape: 'sphere', size: [0.28, 0.28, 0.28], pos: [0, 0.68, 0.22] },
  ],
  [UNITS.chief_inspector.id]: [
    { shape: 'box', size: [0.6, 0.9, 0.44], pos: [0, 0.46, 0] },
    { shape: 'sphere', size: [0.3, 0.3, 0.3], pos: [0, 1.06, 0] },
    { shape: 'box', size: [0.7, 0.1, 0.5], pos: [0, 0.86, 0.1] },
    { shape: 'cyl', size: [0.1, 0.9, 0.1], pos: [0.4, 0.5, 0] }, // the measuring pole
  ],
  [UNITS.raver.id]: [
    { shape: 'box', size: [0.3, 0.5, 0.24], pos: [0, 0.26, 0] },
    { shape: 'sphere', size: [0.24, 0.24, 0.24], pos: [0, 0.62, 0] },
  ],
};

interface Batch {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  capacity: number;
  count: number;
}

interface RageQuit {
  kind: number;
  x: number;
  y: number;
  face: number;
  player: number;
  bornAt: number;
}

const RAGEQUIT_MS = 1000;

/** Per-kind footprint scale so sizes read at RTS zoom. */
const KIND_SCALE: Record<number, number> = {
  [UNITS.clubgoer.id]: 0.85,
  [UNITS.roadie.id]: 0.85,
  [UNITS.raver.id]: 0.8,
  [UNITS.bouncer.id]: 1.08,
  [UNITS.front_left_monk.id]: 1.15,
  [UNITS.bass_cannon.id]: 1.12,
  [UNITS.hakken_bruiser.id]: 1.22,
  [UNITS.chief_inspector.id]: 1.18,
};

export class UnitRenderer {
  private batches = new Map<number, Batch>();
  private cargo: Batch;
  private lastPose = new Map<number, { x: number; y: number; face: number }>();
  private prevAlive = new Map<number, UnitView>();
  private rageQuits: RageQuit[] = [];
  /** Fired when a unit rage-quits or a structure shuts down (sfx/minimap). */
  onDeath: ((view: UnitView) => void) | null = null;

  constructor(private scene: Scene) {
    for (const [kindStr, parts] of Object.entries(SILHOUETTES)) {
      this.batches.set(Number(kindStr), this.makeBatch(`unit-${kindStr}`, parts));
    }
    // Carried-resource marker: a little gold cube above workers.
    this.cargo = this.makeBatch('cargo', [{ shape: 'box', size: [0.24, 0.24, 0.24], pos: [0, 1.05, 0] }]);
  }

  private makeBatch(name: string, parts: Part[]): Batch {
    const meshes: Mesh[] = parts.map((p, i) => {
      let m: Mesh;
      if (p.shape === 'box') {
        m = MeshBuilder.CreateBox(`${name}-${i}`, { width: p.size[0], height: p.size[1], depth: p.size[2] }, this.scene);
      } else if (p.shape === 'cyl') {
        m = MeshBuilder.CreateCylinder(`${name}-${i}`, { diameter: p.size[0], height: p.size[1], tessellation: 10 }, this.scene);
      } else {
        m = MeshBuilder.CreateSphere(`${name}-${i}`, { diameter: p.size[0], segments: 6 }, this.scene);
      }
      m.position.set(p.pos[0], p.pos[1], p.pos[2]);
      return m;
    });
    const merged = Mesh.MergeMeshes(meshes, true, true)!;
    merged.name = name;
    const mat = new StandardMaterial(`${name}-mat`, this.scene);
    mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.22, 0.22, 0.24);
    merged.material = mat;
    merged.isPickable = false;
    merged.thinInstanceRegisterAttribute('color', 4);
    merged.setEnabled(false);
    return { mesh: merged, matrices: new Float32Array(0), colors: new Float32Array(0), capacity: 0, count: 0 };
  }

  private ensure(batch: Batch, needed: number): void {
    if (needed <= batch.capacity) return;
    batch.capacity = Math.max(32, needed * 2);
    batch.matrices = new Float32Array(batch.capacity * 16);
    batch.colors = new Float32Array(batch.capacity * 4);
  }

  private push(batch: Batch, m: Matrix, r: number, g: number, b: number): void {
    this.ensure(batch, batch.count + 1);
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

  /**
   * Render all non-building, non-node views. `beat` is 0..1 beat phase.
   * Views hidden by fog were already filtered by the caller.
   */
  update(views: UnitView[], now: number, beat: number): void {
    const seen = new Set<number>();
    const tmp = new Matrix();
    const q = new Quaternion();
    const scale = new Vector3();
    const trans = new Vector3();

    for (const u of views) {
      if (u.building || u.node) continue;
      seen.add(u.eid);
      const batch = this.batches.get(u.kind) ?? this.batches.get(UNITS.raver.id)!;

      // Facing from movement.
      let pose = this.lastPose.get(u.eid);
      if (!pose) {
        pose = { x: u.x, y: u.y, face: 0 };
        this.lastPose.set(u.eid, pose);
      }
      const dx = u.x - pose.x;
      const dy = u.y - pose.y;
      if (Math.hypot(dx, dy) > 0.02) pose.face = Math.atan2(dx, dy);
      pose.x = u.x;
      pose.y = u.y;

      // Animation: walk-bob while moving, subtle beat-sway when idle.
      let yOff: number;
      let sway = 0;
      if (u.moving) {
        yOff = Math.abs(Math.sin(now / 90 + u.eid)) * 0.14;
        sway = Math.sin(now / 90 + u.eid) * 0.08;
      } else {
        const pulse = Math.sin(beat * Math.PI * 2 + u.eid * 0.9);
        yOff = u.hero ? 0.06 + pulse * 0.05 : Math.max(0, pulse) * 0.05;
      }

      Quaternion.RotationYawPitchRollToRef(pose.face, 0, sway * 0.4, q);
      scale.setAll(u.hero ? 1.28 : (KIND_SCALE[u.kind] ?? 1));
      trans.set(u.x, yOff, u.y);
      Matrix.ComposeToRef(scale, q, trans, tmp);
      const [r, g, b] = TEAM_COLORS[u.player % TEAM_COLORS.length]!;
      this.push(batch, tmp, r, g, b);

      if (u.carrying) {
        scale.setAll(1);
        Matrix.ComposeToRef(scale, q, trans, tmp);
        this.push(this.cargo, tmp, 1.0, 0.85, 0.3);
      }
    }

    // Vanished units rage-quit (nobody dies — they just leave, loudly).
    for (const [eid, u] of this.prevAlive) {
      if (!seen.has(eid)) {
        const pose = this.lastPose.get(eid);
        this.rageQuits.push({ kind: u.kind, x: u.x, y: u.y, face: pose?.face ?? 0, player: u.player, bornAt: now });
        this.lastPose.delete(eid);
        this.onDeath?.(u);
      }
    }
    this.prevAlive.clear();
    for (const u of views) {
      if (!u.building && !u.node) this.prevAlive.set(u.eid, u);
    }

    // Rage-quits: hands up, a spin, then storm off toward the exit and fade.
    for (let i = this.rageQuits.length - 1; i >= 0; i--) {
      const c = this.rageQuits[i]!;
      const age = (now - c.bornAt) / RAGEQUIT_MS;
      if (age >= 1) {
        this.rageQuits.splice(i, 1);
        continue;
      }
      const exitX = Math.sign(c.x - 128) || 1;
      const exitY = Math.sign(c.y - 128) || 1;
      Quaternion.RotationYawPitchRollToRef(c.face + age * 7, 0, 0, q);
      const shrink = Math.max(0.1, 1 - age * 0.9);
      // A brief indignant stretch before the shrink: peak at ~15% in.
      const huff = age < 0.15 ? 1 + age * 2 : 1;
      scale.set(shrink, shrink * huff, shrink);
      trans.set(c.x + exitX * age * 1.6, 0, c.y + exitY * age * 1.6);
      Matrix.ComposeToRef(scale, q, trans, tmp);
      const batch = this.batches.get(c.kind) ?? this.batches.get(UNITS.raver.id)!;
      const [r, g, b] = TEAM_COLORS[c.player % TEAM_COLORS.length]!;
      const dim = 0.6 * (1 - age) + 0.1;
      this.push(batch, tmp, r * dim, g * dim, b * dim);
    }

    for (const batch of this.batches.values()) this.flush(batch);
    this.flush(this.cargo);
  }
}
