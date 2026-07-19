// Engine boot: WebGPU-first with automatic WebGL2 fallback.
// Force the fallback with ?gl=webgl2 for testing.

import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

export interface BootedEngine {
  engine: AbstractEngine;
  backend: 'WebGPU' | 'WebGL2';
}

export async function createGameEngine(canvas: HTMLCanvasElement): Promise<BootedEngine> {
  const forceGl = new URLSearchParams(location.search).get('gl') === 'webgl2';
  if (!forceGl && (navigator as Navigator & { gpu?: unknown }).gpu) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true });
      await engine.initAsync();
      return { engine, backend: 'WebGPU' };
    } catch (err) {
      console.warn('WebGPU init failed, falling back to WebGL2:', err);
    }
  }
  const engine = new Engine(canvas, true);
  return { engine, backend: 'WebGL2' };
}
