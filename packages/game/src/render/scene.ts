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
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { UnitView } from '../simHost.ts';

const TEAM_COLORS: ReadonlyArray<[number, number, number]> = [
  [0.35, 1.0, 0.55], // player 0: neon green
  [1.0, 0.3, 0.75], // player 1: hot magenta
  [0.3, 0.75, 1.0], // player 2: cyan
  [1.0, 0.8, 0.25], // player 3: amber
];

export interface GameScene {
  scene: Scene;
  updateUnits(units: UnitView[]): void;
}

export function createGameScene(engine: AbstractEngine, mapCells: number): GameScene {
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
  const grid = MeshBuilder.CreateLineSystem('grid', { lines: gridLines }, scene);
  grid.color = new Color3(0.14, 0.14, 0.18);
  grid.isPickable = false;

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

  function updateUnits(units: UnitView[]): void {
    if (units.length > capacity) {
      capacity = Math.max(64, units.length * 2);
      matrices = new Float32Array(capacity * 16);
      colors = new Float32Array(capacity * 4);
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      Matrix.TranslationToRef(u.x, 0.55, u.y, tmp);
      tmp.copyToArray(matrices, i * 16);
      const [r, g, b] = TEAM_COLORS[u.player % TEAM_COLORS.length]!;
      colors[i * 4] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = 1;
    }
    unitMesh.thinInstanceSetBuffer('matrix', matrices.subarray(0, units.length * 16), 16, false);
    unitMesh.thinInstanceSetBuffer('color', colors.subarray(0, units.length * 4), 4, false);
    unitMesh.thinInstanceCount = units.length;
  }

  return { scene, updateUnits };
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
    if (keys.has('KeyW') || keys.has('ArrowUp')) dz += speed;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dz -= speed;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= speed;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += speed;
    camera.position.x = Math.min(mapCells, Math.max(0, camera.position.x + dx));
    camera.position.z = Math.min(mapCells, Math.max(-20, camera.position.z + dz));
  });
}
