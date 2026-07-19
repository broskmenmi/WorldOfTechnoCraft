import { buildMap, FP, KIND_UNIT } from '@wotc/sim';
import { Controls } from './input/controls.ts';
import { createGameEngine } from './render/engine.ts';
import { createGameScene } from './render/scene.ts';
import { SimHost, type UnitView } from './simHost.ts';

const MAP_ID = 'skirmish01';
const MAP_CELLS = 256;
const DEMO_UNITS = 50;

function badge(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:12px;left:12px;font:12px monospace;color:#7fff9f;' +
    'background:#000a;padding:6px 10px;border-radius:4px;pointer-events:none;white-space:pre';
  el.textContent = 'booting…';
  document.getElementById('hud')?.appendChild(el);
  return el;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  const { engine, backend } = await createGameEngine(canvas);
  const game = createGameScene(engine, MAP_CELLS, buildMap(MAP_ID));
  const hud = badge();

  const host = new SimHost();
  host.onReady = () => {
    // A squad of obedient units for the player…
    // South floor (below the wall at y≈128) — the squad must path the door.
    const inputs = Array.from({ length: DEMO_UNITS }, (_, i) => ({
      playerId: 0,
      type: 'spawn' as const,
      kind: KIND_UNIT,
      x: (100 + (i % 10) * 4) * FP,
      y: (170 + Math.floor(i / 10) * 4) * FP,
    }));
    // …and a rival crowd milling about beyond the wall (not selectable).
    for (let i = 0; i < 30; i++) {
      inputs.push({
        playerId: 1,
        type: 'spawn' as const,
        kind: 0,
        x: (110 + (i % 6) * 5) * FP,
        y: (60 + Math.floor(i / 6) * 5) * FP,
      });
    }
    host.issue(...inputs);
  };
  host.start(1337, MAP_ID);

  const controls = new Controls(game, host);
  const views: UnitView[] = [];
  let lastFog: Uint8Array | null = null;
  engine.runRenderLoop(() => {
    const now = performance.now();
    host.units(now, views);
    controls.setViews(views);
    if (host.fog && host.fog !== lastFog) {
      lastFog = host.fog;
      game.updateFog(host.fog);
    }
    game.updateUnits(views, now / 1000, host.fog);
    game.updateSelection(views, controls.selected);
    game.scene.render();
    hud.textContent =
      `World of TechnoCraft — ${backend}\n` +
      `fps ${engine.getFps().toFixed(0)}  tick ${host.tick}  units ${views.length}\n` +
      `selected ${controls.selected.size}${controls.attackMovePending ? '  [A-MOVE]' : ''}\n` +
      `LMB select/drag · RMB move · shift-RMB queue · A+RMB attack-move\n` +
      `ctrl+0-9 group · 0-9 recall · dblclick select-type · H stop · Esc clear`;
  });

  window.addEventListener('resize', () => engine.resize());

  // Test/debug hook (harmless in production; used by headless checks).
  (window as unknown as Record<string, unknown>).__wotc = { views, controls, host };
}

void boot();
