// The M2 render shell: RTS camera, ground plane, and units as thin-instanced
// boxes with per-instance team colors. The thin-instance path is deliberate —
// it's the same pipeline the M3 VAT crowd renderer will extend.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { isWalkable, type WalkGrid } from '@wotc/sim';
import type { UnitView } from '../simHost.ts';

const TEAM_COLORS: ReadonlyArray<[number, number, number]> = [
  [0.35, 1.0, 0.55], // player 0: neon green
  [1.0, 0.3, 0.75], // player 1: hot magenta
  [0.3, 0.75, 1.0], // player 2: cyan
  [1.0, 0.8, 0.25], // player 3: amber
];

export interface GameScene {
  scene: Scene;
  camera: FreeCamera;
  ground: Mesh;
  /**
   * `timeSec` drives the beat-bob (presentation only, 128 BPM). `fog` (the
   * local player's grid) hides enemy units outside visible cells.
   */
  updateUnits(units: UnitView[], timeSec: number, fog?: Uint8Array | null): void;
  /** Upload a new fog grid to the overlay texture. */
  updateFog(fog: Uint8Array): void;
  /** Draw selection rings under the given units. */
  updateSelection(units: UnitView[], selected: ReadonlySet<number>): void;
  /** Spawn a short expanding ring at a world position (order feedback). */
  ping(x: number, y: number, kind: 'move' | 'attack'): void;
}

/** Beats per second at the canonical 128 BPM. */
const BEAT_HZ = 128 / 60;

export function createGameScene(
  engine: AbstractEngine,
  mapCells: number,
  grid?: WalkGrid,
): GameScene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.03, 0.03, 0.045, 1);

  // RTS camera: fixed pitch looking down at the map, WASD/arrow pan, wheel zoom.
  const camera = new FreeCamera('rtsCam', new Vector3(mapCells / 2, 40, mapCells / 2 - 28), scene);
  camera.setTarget(new Vector3(mapCells / 2, 0, mapCells / 2));
  camera.inputs.clear(); // no free-look — the camera rig owns movement
  setupCameraRig(scene, camera, mapCells);

  new HemisphericLight('sun', new Vector3(0.2, 1, 0.1), scene).intensity = 0.9;

  const ground = MeshBuilder.CreateGround('ground', { width: mapCells, height: mapCells }, scene);
  ground.position.x = mapCells / 2;
  ground.position.z = mapCells / 2;
  const groundMat = new StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = new Color3(0.07, 0.07, 0.09);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;

  // Faint grid lines every 16 cells (the HPA* cluster size, eventually).
  const gridLines: Vector3[][] = [];
  for (let i = 0; i <= mapCells; i += 16) {
    gridLines.push([new Vector3(i, 0.01, 0), new Vector3(i, 0.01, mapCells)]);
    gridLines.push([new Vector3(0, 0.01, i), new Vector3(mapCells, 0.01, i)]);
  }
  const gridMesh = MeshBuilder.CreateLineSystem('grid', { lines: gridLines }, scene);
  gridMesh.color = new Color3(0.14, 0.14, 0.18);
  gridMesh.isPickable = false;

  // Walls: one box per blocked cell that touches a walkable cell (interior
  // blocked cells are invisible anyway) — one thin-instance batch.
  if (grid) {
    const wallMesh = MeshBuilder.CreateBox('wall', { size: 1 }, scene);
    wallMesh.scaling.y = 2.2;
    const wallMat = new StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new Color3(0.16, 0.15, 0.2);
    wallMat.emissiveColor = new Color3(0.05, 0.04, 0.08);
    wallMat.specularColor = Color3.Black();
    wallMesh.material = wallMat;
    wallMesh.isPickable = false;
    const wallMats: number[] = [];
    const m = Matrix.Identity();
    for (let cy = 0; cy < grid.h; cy++) {
      for (let cx = 0; cx < grid.w; cx++) {
        if (isWalkable(grid, cx, cy)) continue;
        const exposed =
          isWalkable(grid, cx + 1, cy) ||
          isWalkable(grid, cx - 1, cy) ||
          isWalkable(grid, cx, cy + 1) ||
          isWalkable(grid, cx, cy - 1);
        if (!exposed) continue;
        Matrix.TranslationToRef(cx + 0.5, 1.1, cy + 0.5, m);
        const base = wallMats.length;
        wallMats.length += 16;
        m.copyToArray(wallMats, base);
      }
    }
    wallMesh.thinInstanceSetBuffer('matrix', new Float32Array(wallMats), 16, true);
  }

  // Units: one box mesh, thin instances, per-instance color.
  const unitMesh = MeshBuilder.CreateBox('unit', { width: 0.6, depth: 0.6, height: 1.1 }, scene);
  const unitMat = new StandardMaterial('unitMat', scene);
  unitMat.emissiveColor = new Color3(0.25, 0.25, 0.25);
  unitMat.specularColor = Color3.Black();
  unitMesh.material = unitMat;
  unitMesh.thinInstanceRegisterAttribute('color', 4);

  let capacity = 0;
  let matrices = new Float32Array(0);
  let colors = new Float32Array(0);
  const tmp = Matrix.Identity();

  // Health bars: one flat batch above damaged units.
  const barMesh = MeshBuilder.CreateBox('hpbar', { width: 0.9, height: 0.07, depth: 0.12 }, scene);
  const barMat = new StandardMaterial('hpbarMat', scene);
  barMat.disableLighting = true;
  barMat.emissiveColor = Color3.White();
  barMesh.material = barMat;
  barMesh.isPickable = false;
  barMesh.thinInstanceRegisterAttribute('color', 4);
  let barMatrices = new Float32Array(0);
  let barColors = new Float32Array(0);

  function updateUnits(units: UnitView[], timeSec: number, fog?: Uint8Array | null): void {
    if (units.length > capacity) {
      capacity = Math.max(64, units.length * 2);
      matrices = new Float32Array(capacity * 16);
      colors = new Float32Array(capacity * 4);
      barMatrices = new Float32Array(capacity * 16);
      barColors = new Float32Array(capacity * 4);
    }
    const beat = timeSec * BEAT_HZ * Math.PI;
    let n = 0;
    let bars = 0;
    for (const u of units) {
      // Enemies in unseen cells don't get drawn (fog is sim-authoritative).
      if (fog && u.player !== 0) {
        const ci = Math.floor(u.x) + Math.floor(u.y) * mapCells;
        if (fog[ci] !== 2) continue;
      }
      // Everybody dances: a per-unit phase-offset bounce on the beat.
      const bounce = Math.abs(Math.sin(beat + u.eid * 0.7));
      const squash = 1 + bounce * 0.25;
      Matrix.ScalingToRef(1, squash, 1, tmp);
      tmp.setTranslationFromFloats(u.x, 0.55 * squash + bounce * 0.15, u.y);
      tmp.copyToArray(matrices, n * 16);
      const [r, g, b] = TEAM_COLORS[u.player % TEAM_COLORS.length]!;
      colors[n * 4] = r;
      colors[n * 4 + 1] = g;
      colors[n * 4 + 2] = b;
      colors[n * 4 + 3] = 1;
      n++;
      if (u.maxHp > 0 && u.hp < u.maxHp) {
        const frac = Math.max(0, u.hp / u.maxHp);
        Matrix.ScalingToRef(frac, 1, 1, tmp);
        tmp.setTranslationFromFloats(u.x - 0.45 * (1 - frac), 1.7, u.y);
        tmp.copyToArray(barMatrices, bars * 16);
        barColors[bars * 4] = 1 - frac;
        barColors[bars * 4 + 1] = frac;
        barColors[bars * 4 + 2] = 0.15;
        barColors[bars * 4 + 3] = 1;
        bars++;
      }
    }
    unitMesh.thinInstanceSetBuffer('matrix', matrices.subarray(0, n * 16), 16, false);
    unitMesh.thinInstanceSetBuffer('color', colors.subarray(0, n * 4), 4, false);
    unitMesh.thinInstanceCount = n;
    if (bars > 0) {
      barMesh.setEnabled(true);
      barMesh.thinInstanceSetBuffer('matrix', barMatrices.subarray(0, bars * 16), 16, false);
      barMesh.thinInstanceSetBuffer('color', barColors.subarray(0, bars * 4), 4, false);
      barMesh.thinInstanceCount = bars;
    } else {
      barMesh.setEnabled(false);
    }
  }

  // ── Fog overlay ───────────────────────────────────────────────────────────
  // A plane above the world with an alpha texture: unexplored ≈ opaque,
  // explored = dim, visible = clear. Bilinear filtering softens cell edges.
  const fogData = new Uint8Array(mapCells * mapCells * 4);
  fogData.fill(0);
  for (let i = 0; i < mapCells * mapCells; i++) fogData[i * 4 + 3] = 235;
  const fogTexture = RawTexture.CreateRGBATexture(
    fogData,
    mapCells,
    mapCells,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
    Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  const fogPlane = MeshBuilder.CreateGround('fog', { width: mapCells, height: mapCells }, scene);
  fogPlane.position.set(mapCells / 2, 3.2, mapCells / 2);
  fogPlane.isPickable = false;
  const fogMat = new StandardMaterial('fogMat', scene);
  fogMat.diffuseColor = Color3.Black();
  fogMat.specularColor = Color3.Black();
  fogMat.emissiveColor = Color3.Black();
  fogMat.opacityTexture = fogTexture;
  fogMat.disableLighting = true;
  fogPlane.material = fogMat;

  function updateFog(fog: Uint8Array): void {
    for (let i = 0; i < fog.length; i++) {
      fogData[i * 4 + 3] = fog[i] === 2 ? 0 : fog[i] === 1 ? 110 : 235;
    }
    fogTexture.update(fogData);
  }

  // ── Selection rings ───────────────────────────────────────────────────────
  const ringMesh = MeshBuilder.CreateTorus('selRing', { diameter: 1.2, thickness: 0.07, tessellation: 24 }, scene);
  const ringMat = new StandardMaterial('selRingMat', scene);
  ringMat.emissiveColor = new Color3(0.4, 1, 0.6);
  ringMat.disableLighting = true;
  ringMesh.material = ringMat;
  ringMesh.isPickable = false;
  let ringMatrices = new Float32Array(0);

  function updateSelection(units: UnitView[], selected: ReadonlySet<number>): void {
    let count = 0;
    const needed = Math.min(selected.size, units.length) * 16;
    if (ringMatrices.length < needed) ringMatrices = new Float32Array(needed * 2);
    for (const u of units) {
      if (!selected.has(u.eid)) continue;
      Matrix.TranslationToRef(u.x, 0.06, u.y, tmp);
      tmp.copyToArray(ringMatrices, count * 16);
      count++;
    }
    if (count > 0) {
      ringMesh.setEnabled(true);
      ringMesh.thinInstanceSetBuffer('matrix', ringMatrices.subarray(0, count * 16), 16, false);
      ringMesh.thinInstanceCount = count;
    } else {
      ringMesh.setEnabled(false);
    }
  }

  // ── Order pings (expanding rings, ~400 ms) ────────────────────────────────
  const PING_COLORS = { move: new Color3(0.4, 1, 0.6), attack: new Color3(1, 0.35, 0.3) };
  const pings: Array<{ x: number; y: number; t0: number; mesh: Mesh }> = [];
  const pingProto = MeshBuilder.CreateTorus('ping', { diameter: 1, thickness: 0.06, tessellation: 24 }, scene);
  pingProto.setEnabled(false);
  pingProto.isPickable = false;

  function ping(x: number, y: number, kind: 'move' | 'attack'): void {
    const mesh = pingProto.clone(`ping-${performance.now()}`);
    const mat = new StandardMaterial('pingMat', scene);
    mat.emissiveColor = PING_COLORS[kind];
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.position.set(x, 0.08, y);
    mesh.setEnabled(true);
    pings.push({ x, y, t0: performance.now(), mesh });
  }

  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now();
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i]!;
      const age = (now - p.t0) / 400;
      if (age >= 1) {
        p.mesh.material?.dispose();
        p.mesh.dispose();
        pings.splice(i, 1);
      } else {
        const s = 0.4 + age * 1.6;
        p.mesh.scaling.set(s, 1, s);
        p.mesh.visibility = 1 - age;
      }
    }
  });

  return { scene, camera, ground, updateUnits, updateFog, updateSelection, ping };
}

function setupCameraRig(scene: Scene, camera: FreeCamera, mapCells: number): void {
  const keys = new Set<string>();
  const canvas = scene.getEngine().getRenderingCanvas();
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  canvas?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    camera.position.y = Math.min(90, Math.max(14, camera.position.y + dir * 4));
    camera.position.z -= dir * 2.4; // keep the RTS pitch feeling constant
  });

  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    const speed = 28 * dt * (camera.position.y / 40 + 0.4);
    let dx = 0;
    let dz = 0;
    // Arrow keys only — letter keys belong to unit controls (A = attack-move).
    if (keys.has('ArrowUp')) dz += speed;
    if (keys.has('ArrowDown')) dz -= speed;
    if (keys.has('ArrowLeft')) dx -= speed;
    if (keys.has('ArrowRight')) dx += speed;
    camera.position.x = Math.min(mapCells, Math.max(0, camera.position.x + dx));
    camera.position.z = Math.min(mapCells, Math.max(-20, camera.position.z + dz));
  });
}
