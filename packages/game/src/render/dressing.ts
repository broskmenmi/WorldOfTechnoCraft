// Map dressing: tinted floor, neon wall strips, prop piles, and beat-synced
// laser fans over both bases. Static geometry is merged once; only the lasers
// animate.

import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { isWalkable, type WalkGrid } from '@wotc/sim';

const CLUB = { x: 50, y: 206 }; // player HQ area (skirmish02)
const CAMP = { x: 206, y: 50 }; // legion HQ area

export class Dressing {
  private lasers: Mesh[] = [];

  constructor(scene: Scene, grid: WalkGrid, ground: Mesh, mapCells: number) {
    this.paintFloor(scene, ground, mapCells);
    this.neonStrips(scene, grid);
    this.props(scene);
    this.laserFans(scene);
  }

  /** District-tinted floor texture, painted once. */
  private paintFloor(scene: Scene, ground: Mesh, mapCells: number): void {
    const tex = new DynamicTexture('floorTex', { width: 512, height: 512 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#101016';
    ctx.fillRect(0, 0, 512, 512);
    const paintZone = (cx: number, cy: number, r: number, color: string) => {
      const g = ctx.createRadialGradient(
        (cx / mapCells) * 512,
        (cy / mapCells) * 512,
        0,
        (cx / mapCells) * 512,
        (cy / mapCells) * 512,
        (r / mapCells) * 512,
      );
      g.addColorStop(0, color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
    };
    paintZone(CLUB.x, CLUB.y, 70, '#241b33'); // club side: purple haze
    paintZone(CAMP.x, CAMP.y, 70, '#33161b'); // legion side: red glow
    paintZone(128, 134, 45, '#1b2429'); // contested middle: cold teal
    // Speckle: worn-floor noise.
    ctx.fillStyle = '#ffffff08';
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      ctx.fillRect(rnd() * 512, rnd() * 512, 1.6, 1.6);
    }
    tex.update();
    const mat = new StandardMaterial('floorMat', scene);
    mat.diffuseTexture = tex;
    mat.specularColor = Color3.Black();
    ground.material = mat;
  }

  /** Emissive strips along the great wall's faces. */
  private neonStrips(scene: Scene, grid: WalkGrid): void {
    const strips: Mesh[] = [];
    // The wall occupies rows 126..129; put strips where wall meets open floor.
    for (let x = 2; x < grid.w - 2; x++) {
      if (!isWalkable(grid, x, 126) && isWalkable(grid, x, 125)) {
        strips.push(this.strip(scene, x + 0.5, 125.9));
      }
      if (!isWalkable(grid, x, 129) && isWalkable(grid, x, 130)) {
        strips.push(this.strip(scene, x + 0.5, 130.1));
      }
    }
    if (strips.length > 0) {
      const merged = Mesh.MergeMeshes(strips, true, true)!;
      const mat = new StandardMaterial('neonMat', scene);
      mat.emissiveColor = new Color3(0.55, 0.2, 0.8);
      mat.disableLighting = true;
      merged.material = mat;
      merged.isPickable = false;
    }
  }

  private strip(scene: Scene, x: number, z: number): Mesh {
    const m = MeshBuilder.CreateBox('neon', { width: 1, height: 0.12, depth: 0.08 }, scene);
    m.position.set(x, 1.9, z);
    return m;
  }

  /** Speaker piles and crates near each base. */
  private props(scene: Scene): void {
    const parts: Mesh[] = [];
    const pile = (x: number, z: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const b = MeshBuilder.CreateBox('prop', { width: 0.9, height: 0.6, depth: 0.7 }, scene);
        b.position.set(x + (i % 2) * 0.5, 0.3 + Math.floor(i / 2) * 0.62, z + (i % 3) * 0.3);
        b.rotation.y = i * 0.35;
        parts.push(b);
      }
    };
    pile(58, 196, 4);
    pile(41, 199, 3);
    pile(214, 58, 4);
    pile(198, 41, 3);
    pile(124, 137, 2); // the contested middle has gear lying around too
    const merged = Mesh.MergeMeshes(parts, true, true)!;
    const mat = new StandardMaterial('propMat', scene);
    mat.diffuseColor = new Color3(0.16, 0.15, 0.19);
    mat.emissiveColor = new Color3(0.05, 0.05, 0.07);
    mat.specularColor = Color3.Black();
    merged.material = mat;
    merged.isPickable = false;
  }

  /** Rotating laser fans over both HQs. */
  private laserFans(scene: Scene): void {
    const colors: Array<[number, number, number]> = [
      [0.2, 1, 0.5],
      [1, 0.2, 0.7],
      [0.2, 0.6, 1],
      [1, 0.8, 0.2],
    ];
    for (const base of [CLUB, CAMP]) {
      for (let i = 0; i < 4; i++) {
        const beam = MeshBuilder.CreatePlane('laser', { width: 44, height: 0.18 }, scene);
        const mat = new StandardMaterial(`laserMat-${base.x}-${i}`, scene);
        const [r, g, b] = colors[i]!;
        mat.emissiveColor = new Color3(r, g, b);
        mat.disableLighting = true;
        mat.alpha = 0.35;
        mat.backFaceCulling = false;
        beam.material = mat;
        beam.position.set(base.x + 2, 7 + i * 0.6, base.y + 2);
        beam.rotation.x = Math.PI / 2;
        beam.isPickable = false;
        beam.metadata = { phase: (i * Math.PI) / 2, speed: 0.4 + i * 0.13 };
        this.lasers.push(beam);
      }
    }
    scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (const beam of this.lasers) {
        const meta = beam.metadata as { phase: number; speed: number };
        beam.rotation.y = meta.phase + t * meta.speed;
      }
    });
  }

  /** Pulse laser brightness on the beat (called from the render loop). */
  pulse(beat: number, night: boolean): void {
    const pump = 0.22 + Math.max(0, Math.sin(beat * Math.PI * 2)) * (night ? 0.5 : 0.3);
    for (const beam of this.lasers) {
      (beam.material as StandardMaterial).alpha = pump;
    }
  }
}
