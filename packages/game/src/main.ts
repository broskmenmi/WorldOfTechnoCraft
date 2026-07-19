import { buildMap, FP } from '@wotc/sim';
import { BUILDINGS, DOOR_POLICIES, UNITS } from '@wotc/data';
import type { CommandInput } from './protocol.ts';
import { Controls } from './input/controls.ts';
import { createGameEngine } from './render/engine.ts';
import { createGameScene } from './render/scene.ts';
import { SimHost, type UnitView } from './simHost.ts';

const MAP_ID = 'skirmish01';
const MAP_CELLS = 256;

function badge(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:12px;left:12px;font:12px monospace;color:#7fff9f;' +
    'background:#000a;padding:6px 10px;border-radius:4px;pointer-events:none;white-space:pre';
  el.textContent = 'booting…';
  document.getElementById('hud')?.appendChild(el);
  return el;
}

/** The Powerplant forecourt scenario: your club on the south floor,
 * the Legion warcamp beyond the wall. */
function scenario(): CommandInput[] {
  const inputs: CommandInput[] = [];
  const p0 = (i: CommandInput) => inputs.push(i);
  // Starting resources.
  p0({ playerId: 0, type: 'grant', cash: 400, vibe: 0 });
  // The club.
  p0({ playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.the_door.id, cellX: 116, cellY: 196 });
  p0({ playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.dancefloor.id, cellX: 104, cellY: 188 });
  p0({ playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.bar.id, cellX: 128, cellY: 190 });
  // Staff and crowd.
  for (let i = 0; i < 6; i++) {
    p0({ playerId: 0, type: 'spawn', kind: UNITS.clubgoer.id, x: (105 + (i % 3) * 2) * FP, y: (186 - Math.floor(i / 3) * 2) * FP });
  }
  for (let i = 0; i < 2; i++) {
    p0({ playerId: 0, type: 'spawn', kind: UNITS.cable_guy.id, x: (122 + i * 2) * FP, y: 194 * FP });
  }
  for (let i = 0; i < 4; i++) {
    p0({ playerId: 0, type: 'spawn', kind: UNITS.bouncer.id, x: (114 + i * 3) * FP, y: 180 * FP });
  }
  // The Legion, beyond the wall.
  p0({ playerId: 1, type: 'spawnBuilding', kind: BUILDINGS.warcamp.id, cellX: 118, cellY: 30 });
  for (let i = 0; i < 6; i++) {
    p0({ playerId: 1, type: 'spawn', kind: UNITS.gabber.id, x: (112 + (i % 3) * 4) * FP, y: (40 + Math.floor(i / 3) * 3) * FP });
  }
  return inputs;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  const { engine, backend } = await createGameEngine(canvas);
  const grid = buildMap(MAP_ID);
  const game = createGameScene(engine, MAP_CELLS, grid);
  const hud = badge();

  const host = new SimHost();
  host.onReady = () => host.issue(...scenario());
  host.start(1337, MAP_ID);

  // Start the camera over the club, not the map center.
  game.camera.position.x = 120;
  game.camera.position.z = 160;

  const controls = new Controls(game, host, grid);
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
    const build = controls.buildModeName();
    hud.textContent =
      `World of TechnoCraft — ${backend}  fps ${engine.getFps().toFixed(0)}  tick ${host.tick}\n` +
      `cash €${host.cash}  vibe ${host.vibe}  heat ${host.heat}  door: ${DOOR_POLICIES[host.policy]?.name ?? '?'}\n` +
      `selected ${controls.selected.size}${controls.attackMovePending ? '  [A-MOVE]' : ''}${build ? `  [BUILD: ${build}]` : ''}\n` +
      `LMB select · RMB move/rally · shift queue · A attack-move · B build (cycle) · P door policy\n` +
      `bldg keys: T/Y/U/I train · ctrl+0-9 group · dblclick type · H stop · Esc cancel`;
  });

  window.addEventListener('resize', () => engine.resize());

  // Test/debug hook (harmless in production; used by headless checks).
  (window as unknown as Record<string, unknown>).__wotc = { views, controls, host };
}

void boot();
