// The permanent perf canary: /bench.html?units=1500
// Spawns N sim-driven walkers and reports rolling frame-time stats + draw
// calls. Numbers per milestone are logged in docs/perf-log.md.

import { FP } from '@wotc/sim';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { createGameEngine } from '../render/engine.ts';
import { createGameScene } from '../render/scene.ts';
import { SimHost, type UnitView } from '../simHost.ts';

const MAP_CELLS = 256;
const params = new URLSearchParams(location.search);
const UNITS = Math.min(4000, Number(params.get('units') ?? 1500));

function overlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:12px;left:12px;font:13px monospace;color:#ffd75f;' +
    'background:#000c;padding:8px 12px;border-radius:4px;pointer-events:none;white-space:pre';
  document.getElementById('hud')?.appendChild(el);
  return el;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  const { engine, backend } = await createGameEngine(canvas);
  const { scene, updateUnits } = createGameScene(engine, MAP_CELLS);
  const instrumentation = new SceneInstrumentation(scene);
  const hud = overlay();

  const host = new SimHost();
  host.onReady = () => {
    // Spiral spawn so the crowd fills the camera without overlapping stacks.
    const inputs = [];
    const cols = Math.ceil(Math.sqrt(UNITS));
    for (let i = 0; i < UNITS; i++) {
      inputs.push({
        playerId: i % 4,
        type: 'spawn' as const,
        kind: 0,
        x: Math.round((64 + (i % cols) * (128 / cols)) * FP),
        y: Math.round((64 + Math.floor(i / cols) * (128 / cols)) * FP),
      });
    }
    host.issue(...inputs);
  };
  host.start(23, 'empty256');

  const frameTimes: number[] = [];
  let last = performance.now();
  const views: UnitView[] = [];

  engine.runRenderLoop(() => {
    const now = performance.now();
    frameTimes.push(now - last);
    last = now;
    if (frameTimes.length > 600) frameTimes.shift();

    updateUnits(host.units(now, views), now / 1000);
    scene.render();

    if (frameTimes.length % 30 === 0) {
      const sorted = frameTimes.slice().sort((a, b) => a - b);
      const avg = frameTimes.reduce((s, v) => s + v, 0) / frameTimes.length;
      const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
      hud.textContent =
        `WoTC crowd bench — ${backend}\n` +
        `units    ${views.length} / ${UNITS}\n` +
        `frame    avg ${avg.toFixed(2)} ms  p95 ${p95.toFixed(2)} ms  (${(1000 / avg).toFixed(0)} fps)\n` +
        `draws    ${instrumentation.drawCallsCounter.current}\n` +
        `sim tick ${host.tick}`;
    }
  });

  window.addEventListener('resize', () => engine.resize());
}

void boot();
