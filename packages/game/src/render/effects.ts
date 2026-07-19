// Combat feedback: impact flashes on damage, tracer bolts from ranged
// attackers, shockwave rings for big moments. Pure presentation — everything
// is inferred from per-frame view diffs.

import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { UNITS_BY_ID, BUILDINGS_BY_ID } from '@wotc/data';
import type { UnitView } from '../simHost.ts';

export interface DamageEvent {
  victim: UnitView;
  amount: number;
}

interface Fx {
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  bornAt: number;
  life: number;
  kind: 'flash' | 'tracer' | 'ring';
  scale: number;
  color: [number, number, number];
}

function rangedRange(v: UnitView): number {
  if (v.building) return (BUILDINGS_BY_ID.get(v.kind)?.range ?? 0) / 1024;
  const def = UNITS_BY_ID.get(v.kind);
  return def && def.range >= 2048 ? def.range / 1024 : 0;
}

export class Effects {
  private flashBatch: Mesh;
  private tracerBatch: Mesh;
  private ringBatch: Mesh;
  private fx: Fx[] = [];
  private screenFlash: HTMLDivElement;

  constructor(private scene: Scene) {
    const mat = (name: string, r: number, g: number, b: number) => {
      const m = new StandardMaterial(name, scene);
      m.emissiveColor = new Color3(r, g, b);
      m.disableLighting = true;
      return m;
    };
    this.flashBatch = MeshBuilder.CreatePlane('fx-flash', { size: 1 }, scene);
    this.flashBatch.rotation.x = Math.PI / 2;
    this.flashBatch.bakeCurrentTransformIntoVertices();
    this.flashBatch.material = mat('fx-flash-mat', 1, 0.9, 0.6);
    this.tracerBatch = MeshBuilder.CreateBox('fx-tracer', { width: 0.08, height: 0.08, depth: 1 }, scene);
    this.tracerBatch.material = mat('fx-tracer-mat', 0.8, 0.95, 1);
    this.ringBatch = MeshBuilder.CreateTorus('fx-ring', { diameter: 1, thickness: 0.08, tessellation: 28 }, scene);
    this.ringBatch.material = mat('fx-ring-mat', 1, 1, 1);
    for (const m of [this.flashBatch, this.tracerBatch, this.ringBatch]) {
      m.isPickable = false;
      m.thinInstanceRegisterAttribute('color', 4);
      m.setEnabled(false);
    }
    this.screenFlash = document.createElement('div');
    this.screenFlash.style.cssText =
      'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .5s';
    document.getElementById('hud')?.appendChild(this.screenFlash);
  }

  /** Big moment: whole-screen white pop (THE DROP). */
  dropFlash(): void {
    this.screenFlash.style.transition = 'none';
    this.screenFlash.style.opacity = '0.75';
    requestAnimationFrame(() => {
      this.screenFlash.style.transition = 'opacity .6s';
      this.screenFlash.style.opacity = '0';
    });
  }

  ring(x: number, y: number, scale: number, color: [number, number, number]): void {
    this.fx.push({ x, y, bornAt: performance.now(), life: 600, kind: 'ring', scale, color });
  }

  /** Feed this frame's damage events + the current views (for tracer sources). */
  update(damage: DamageEvent[], views: UnitView[], now: number): void {
    for (const ev of damage) {
      const v = ev.victim;
      this.fx.push({ x: v.x, y: v.y, bornAt: now, life: 180, kind: 'flash', scale: 0.6, color: [1, 0.85, 0.5] });
      // Find a plausible ranged shooter: nearest hostile ranged unit in range.
      let best: UnitView | null = null;
      let bestD = Infinity;
      for (const s of views) {
        if (s.player === v.player || s.node) continue;
        const range = rangedRange(s);
        if (range === 0) continue;
        const d = Math.hypot(s.x - v.x, s.y - v.y);
        if (d <= range + 1 && d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) {
        this.fx.push({
          x: best.x,
          y: best.y,
          x2: v.x,
          y2: v.y,
          bornAt: now,
          life: 120,
          kind: 'tracer',
          scale: 1,
          color: best.player === 0 ? [0.6, 1, 0.8] : [1, 0.6, 0.8],
        });
      }
    }

    // Draw.
    const tmp = new Matrix();
    const q = new Quaternion();
    const scale = new Vector3();
    const trans = new Vector3();
    const batches: Record<Fx['kind'], { mesh: Mesh; mats: number[]; cols: number[] }> = {
      flash: { mesh: this.flashBatch, mats: [], cols: [] },
      tracer: { mesh: this.tracerBatch, mats: [], cols: [] },
      ring: { mesh: this.ringBatch, mats: [], cols: [] },
    };
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      const age = (now - f.bornAt) / f.life;
      if (age >= 1) {
        this.fx.splice(i, 1);
        continue;
      }
      const b = batches[f.kind];
      if (f.kind === 'tracer' && f.x2 !== undefined && f.y2 !== undefined) {
        const dx = f.x2 - f.x;
        const dy = f.y2 - f.y;
        const len = Math.hypot(dx, dy);
        Quaternion.RotationYawPitchRollToRef(Math.atan2(dx, dy), 0, 0, q);
        scale.set(1, 1, len);
        trans.set((f.x + f.x2) / 2, 0.8, (f.y + f.y2) / 2);
      } else if (f.kind === 'ring') {
        q.set(0, 0, 0, 1);
        const s = f.scale * (0.3 + age * 1.7);
        scale.set(s, 1, s);
        trans.set(f.x, 0.15, f.y);
      } else {
        q.set(0, 0, 0, 1);
        const s = f.scale * (0.5 + age);
        scale.set(s, 1, s);
        trans.set(f.x, 1.1, f.y);
      }
      Matrix.ComposeToRef(scale, q, trans, tmp);
      const base = b.mats.length;
      b.mats.length += 16;
      tmp.copyToArray(b.mats, base);
      const fade = 1 - age;
      b.cols.push(f.color[0] * fade, f.color[1] * fade, f.color[2] * fade, 1);
    }
    for (const { mesh, mats, cols } of Object.values(batches)) {
      const count = cols.length / 4;
      if (count > 0) {
        mesh.setEnabled(true);
        mesh.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, false);
        mesh.thinInstanceSetBuffer('color', new Float32Array(cols), 4, false);
        mesh.thinInstanceCount = count;
      } else {
        mesh.setEnabled(false);
      }
    }
  }
}
