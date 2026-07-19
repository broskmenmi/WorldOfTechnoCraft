import { buildMap, decodeReplay, encodeReplay, FP, type MapId } from '@wotc/sim';
import { BUILDINGS, DOOR_POLICIES, UNITS } from '@wotc/data';
import type { CommandInput } from './protocol.ts';
import { Controls } from './input/controls.ts';
import { createGameEngine } from './render/engine.ts';
import { createGameScene } from './render/scene.ts';
import { SimHost, type UnitView } from './simHost.ts';
import { Minimap } from './ui/minimap.ts';
import { BarkFeed } from './ui/barks.ts';
import { TechnoEngine } from './audio/techno.ts';
import { Color4 } from '@babylonjs/core/Maths/math.color';

const MAP_ID: MapId = 'skirmish01';
const MAP_CELLS = 256;
const REPLAY_KEY = 'wotc-replay';

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
  const p = (i: CommandInput) => inputs.push(i);
  p({ playerId: 0, type: 'grant', cash: 400, vibe: 0 });
  p({ playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.the_door.id, cellX: 116, cellY: 196 });
  p({ playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.dancefloor.id, cellX: 104, cellY: 188 });
  p({ playerId: 0, type: 'spawnBuilding', kind: BUILDINGS.bar.id, cellX: 128, cellY: 190 });
  for (let i = 0; i < 6; i++) {
    p({ playerId: 0, type: 'spawn', kind: UNITS.clubgoer.id, x: (105 + (i % 3) * 2) * FP, y: (186 - Math.floor(i / 3) * 2) * FP });
  }
  for (let i = 0; i < 2; i++) {
    p({ playerId: 0, type: 'spawn', kind: UNITS.cable_guy.id, x: (122 + i * 2) * FP, y: 194 * FP });
  }
  for (let i = 0; i < 4; i++) {
    p({ playerId: 0, type: 'spawn', kind: UNITS.bouncer.id, x: (114 + i * 3) * FP, y: 180 * FP });
  }
  p({ playerId: 1, type: 'spawnBuilding', kind: BUILDINGS.warcamp.id, cellX: 118, cellY: 30 });
  for (let i = 0; i < 6; i++) {
    p({ playerId: 1, type: 'spawn', kind: UNITS.gabber.id, x: (112 + (i % 3) * 4) * FP, y: (40 + Math.floor(i / 3) * 3) * FP });
  }
  return inputs;
}

function fmtClock(ticksLeft: number): string {
  const s = Math.max(0, Math.ceil(ticksLeft / 20));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showMatchEnd(won: boolean, peakVibe: number, isReplay: boolean): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'flex-direction:column;background:#000a;pointer-events:auto;font-family:monospace;text-align:center';
  el.innerHTML = won
    ? `<div style="font-size:42px;color:#ffd75f">☀ SUNRISE ☀</div>
       <div style="font-size:16px;color:#e8e8e8;margin:12px">You held the floor. The shutters snap open to a roar.</div>
       <div style="font-size:14px;color:#7fff9f">Peak Vibe: ${peakVibe}</div>`
    : `<div style="font-size:42px;color:#ff5f5f">THE DOOR HAS FALLEN</div>
       <div style="font-size:16px;color:#e8e8e8;margin:12px">The club is a memory. Somewhere, a purist says it was better before.</div>`;
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12px;color:#888;margin-top:16px';
  hint.textContent = isReplay
    ? 'replay finished — reload without ?replay to play'
    : 'F5 to run it back · F9 saved a replay of this night';
  el.appendChild(hint);
  document.getElementById('hud')?.appendChild(el);
}

const NIGHT = new Color4(0.03, 0.03, 0.045, 1);
const PREDAWN = new Color4(0.1, 0.05, 0.12, 1);
const DAWN = new Color4(0.45, 0.22, 0.12, 1);

function skyAt(t: number): Color4 {
  const lerp = (a: Color4, b: Color4, f: number) =>
    new Color4(a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f, 1);
  return t < 0.7 ? lerp(NIGHT, PREDAWN, t / 0.7) : lerp(PREDAWN, DAWN, (t - 0.7) / 0.3);
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  const { engine, backend } = await createGameEngine(canvas);
  const grid = buildMap(MAP_ID);
  const game = createGameScene(engine, MAP_CELLS, grid);
  const hud = badge();

  // Replay playback: ?replay=local loads the last F9-saved replay.
  const isReplay = new URLSearchParams(location.search).get('replay') === 'local';
  let replayCommands = null;
  if (isReplay) {
    const raw = localStorage.getItem(REPLAY_KEY);
    if (raw) replayCommands = decodeReplay(raw);
  }

  const host = new SimHost();
  if (!isReplay) host.onReady = () => host.issue(...scenario());
  host.start(replayCommands?.seed ?? 1337, (replayCommands?.mapId as MapId) ?? MAP_ID, replayCommands?.commands);

  game.camera.position.x = 120;
  game.camera.position.z = 160;

  const barks = new BarkFeed();
  const audio = new TechnoEngine();
  const controls = new Controls(game, host, grid, barks);
  const minimap = new Minimap(grid, game.camera);
  window.addEventListener('pointerdown', () => audio.start(), { once: true });
  window.addEventListener('keydown', (e) => {
    audio.start();
    if (e.code === 'KeyM') audio.toggleMute();
    if (e.code === 'F9') {
      e.preventDefault();
      const json = encodeReplay(host.buildReplay());
      localStorage.setItem(REPLAY_KEY, json);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `wotc-replay-${Date.now()}.json`;
      a.click();
      barks.event('buildingComplete');
    }
  });

  const views: UnitView[] = [];
  let lastFog: Uint8Array | null = null;
  let lastRaids = 0;
  let lastWaves = 0;
  let ended = false;

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
    minimap.update(views, host.fog, now);
    game.scene.clearColor = skyAt(Math.min(1, host.tick / host.sunriseTick));
    game.scene.render();

    // Events → barks + music intensity.
    if (host.raidsSpawned > lastRaids) {
      lastRaids = host.raidsSpawned;
      barks.event('raidIncoming');
    }
    if (host.wavesSpawned > lastWaves) {
      lastWaves = host.wavesSpawned;
      barks.event('underAttack');
    }
    const doorView = views.find((v) => v.building && v.kind === BUILDINGS.the_door.id && v.player === 0);
    let danger = false;
    if (doorView) {
      danger = views.some(
        (v) => v.player === 1 && !v.building && Math.hypot(v.x - doorView.x, v.y - doorView.y) < 45,
      );
    }
    audio.intensity = danger ? (host.heat >= 100 ? 3 : 2) : 1;

    if (host.matchState !== 0 && !ended) {
      ended = true;
      if (!isReplay) localStorage.setItem(REPLAY_KEY, encodeReplay(host.buildReplay()));
      showMatchEnd(host.matchState === 1, host.peakVibe, isReplay);
    }

    const build = controls.buildModeName();
    hud.textContent =
      `World of TechnoCraft — ${backend}  fps ${engine.getFps().toFixed(0)}  tick ${host.tick}${isReplay ? '  [REPLAY]' : ''}\n` +
      `cash €${host.cash}  vibe ${host.vibe}  heat ${host.heat}  door: ${DOOR_POLICIES[host.policy]?.name ?? '?'}\n` +
      `☀ sunrise in ${fmtClock(host.sunriseTick - host.tick)}   wave ${host.wavesSpawned}  raids ${host.raidsSpawned}\n` +
      `selected ${controls.selected.size}${controls.attackMovePending ? '  [A-MOVE]' : ''}${build ? `  [BUILD: ${build}]` : ''}\n` +
      `LMB select · RMB move/rally · shift queue · A attack-move · B build · P door policy · M mute · F9 replay`;
  });

  window.addEventListener('resize', () => engine.resize());

  // Test/debug hook (harmless in production; used by headless checks).
  (window as unknown as Record<string, unknown>).__wotc = { views, controls, host };
}

void boot();
