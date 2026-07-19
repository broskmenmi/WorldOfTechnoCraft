import { FP } from '@wotc/sim';
import { createGameEngine } from './render/engine.ts';
import { createGameScene } from './render/scene.ts';
import { SimHost, type UnitView } from './simHost.ts';

const MAP_CELLS = 256;
const DEMO_UNITS = 50;

function badge(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:12px;left:12px;font:12px monospace;color:#7fff9f;' +
    'background:#000a;padding:6px 10px;border-radius:4px;pointer-events:none;white-space:pre';
  el.textContent = text;
  document.getElementById('hud')?.appendChild(el);
  return el;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  const { engine, backend } = await createGameEngine(canvas);
  const { scene, updateUnits } = createGameScene(engine, MAP_CELLS);
  const hud = badge('booting…');

  const host = new SimHost();
  host.onReady = () => {
    // Scatter demo walkers around the map center (the "club floor").
    const inputs = Array.from({ length: DEMO_UNITS }, (_, i) => ({
      playerId: i % 2,
      type: 'spawn' as const,
      kind: 0,
      x: (96 + (i % 10) * 7) * FP,
      y: (96 + Math.floor(i / 10) * 7) * FP,
    }));
    host.issue(...inputs);
  };
  host.start(1337, MAP_CELLS);

  const views: UnitView[] = [];
  engine.runRenderLoop(() => {
    updateUnits(host.units(performance.now(), views));
    scene.render();
    hud.textContent =
      `World of TechnoCraft — ${backend}\n` +
      `fps ${engine.getFps().toFixed(0)}  tick ${host.tick}  units ${views.length}\n` +
      `crossOriginIsolated ${globalThis.crossOriginIsolated}`;
  });

  window.addEventListener('resize', () => engine.resize());
}

void boot();
