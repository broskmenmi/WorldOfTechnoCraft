import { buildMap, CYCLE_TICKS, DAY_TICKS, decodeReplay, encodeReplay, type MapId } from '@wotc/sim';
import { Controls } from './input/controls.ts';
import { createGameEngine } from './render/engine.ts';
import { createGameScene } from './render/scene.ts';
import { SimHost, type UnitView } from './simHost.ts';
import { Minimap } from './ui/minimap.ts';
import { BarkFeed } from './ui/barks.ts';
import { isTouchDevice, TouchBar } from './ui/touchbar.ts';
import { setupHelp } from './ui/help.ts';
import { TechnoEngine } from './audio/techno.ts';
import { Color4 } from '@babylonjs/core/Maths/math.color';

const MAP_ID: MapId = 'skirmish02';
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

function showMatchEnd(won: boolean, isReplay: boolean): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'flex-direction:column;background:#000a;pointer-events:auto;font-family:monospace;text-align:center';
  el.innerHTML = won
    ? `<div style="font-size:42px;color:#ffd75f">THE WARCAMP HAS FALLEN</div>
       <div style="font-size:16px;color:#e8e8e8;margin:12px">Rotterdam is quiet. Somewhere, one last hug is exchanged.<br>Your club stands. The scene is yours.</div>`
    : `<div style="font-size:42px;color:#ff5f5f">THE CLUB IS RUBBLE</div>
       <div style="font-size:16px;color:#e8e8e8;margin:12px">The Legion renamed the ruins "Amsterdam?" and hugged everyone on the way out.</div>`;
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12px;color:#888;margin-top:16px';
  hint.textContent = isReplay
    ? 'replay finished — reload without ?replay to play'
    : 'F5 to run it back · F9 saved a replay of this match';
  el.appendChild(hint);
  document.getElementById('hud')?.appendChild(el);
}

// Day/night sky: warm dusk → deep night → dawn, cycling with the sim clock.
const DAY = new Color4(0.09, 0.08, 0.12, 1);
const NIGHT = new Color4(0.02, 0.02, 0.04, 1);

function skyAt(tick: number): Color4 {
  const t = tick % CYCLE_TICKS;
  const lerp = (a: Color4, b: Color4, f: number) =>
    new Color4(a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f, 1);
  if (t < DAY_TICKS) {
    // Daytime with a dusk ramp in the last 10%.
    const dusk = t > DAY_TICKS * 0.9 ? (t - DAY_TICKS * 0.9) / (DAY_TICKS * 0.1) : 0;
    return lerp(DAY, NIGHT, dusk);
  }
  const nt = (t - DAY_TICKS) / (CYCLE_TICKS - DAY_TICKS);
  // Night with a dawn ramp in the last 15%.
  const dawn = nt > 0.85 ? (nt - 0.85) / 0.15 : 0;
  return lerp(NIGHT, DAY, dawn);
}

function fmtCd(ticks: number): string {
  return ticks > 0 ? ` ${Math.ceil(ticks / 20)}s` : '';
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  const { engine, backend } = await createGameEngine(canvas);
  const grid = buildMap(MAP_ID);
  const game = createGameScene(engine, MAP_CELLS, grid);
  const hud = badge();

  const isReplay = new URLSearchParams(location.search).get('replay') === 'local';
  let replayCommands = null;
  if (isReplay) {
    const raw = localStorage.getItem(REPLAY_KEY);
    if (raw) replayCommands = decodeReplay(raw);
  }

  const host = new SimHost();
  if (!isReplay) host.onReady = () => host.issue({ playerId: 0, type: 'setup' });
  host.start(replayCommands?.seed ?? 1337, (replayCommands?.mapId as MapId) ?? MAP_ID, replayCommands?.commands);

  // Start over the player's base (SW corner of skirmish02).
  game.camera.position.x = 52;
  game.camera.position.z = 178;

  const barks = new BarkFeed();
  const audio = new TechnoEngine();
  const controls = new Controls(game, host, grid, barks);
  const minimap = new Minimap(grid, game.camera);
  const touch = isTouchDevice();
  const touchBar = touch ? new TouchBar(controls, audio) : null;
  setupHelp(touch);
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
    }
  });

  const views: UnitView[] = [];
  let lastFog: Uint8Array | null = null;
  let lastRaids = 0;
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
    game.scene.clearColor = skyAt(host.tick);
    game.scene.render();

    if (host.raidsSpawned > lastRaids) {
      lastRaids = host.raidsSpawned;
      barks.event('raidIncoming');
    }
    // Music intensity: enemies near own buildings = danger.
    const ownBuildings = views.filter((v) => v.building && v.player === 0);
    const danger = views.some(
      (v) =>
        v.player !== 0 &&
        !v.building &&
        !v.node &&
        ownBuildings.some((b) => Math.hypot(v.x - b.x, v.y - b.y) < 30),
    );
    audio.intensity = danger ? (host.night ? 3 : 2) : 1;

    if (host.matchState !== 0 && !ended) {
      ended = true;
      if (!isReplay) localStorage.setItem(REPLAY_KEY, encodeReplay(host.buildReplay()));
      showMatchEnd(host.matchState === 1, isReplay);
    }

    touchBar?.update();
    const h = host.hero;
    const heroLine =
      h.eid !== 0
        ? `DJ lvl ${h.level}  xp ${h.xp}/${h.xpNext}  hype ${h.hype}/${h.hypeMax}` +
          `  Q${fmtCd(h.cds[0])} W${fmtCd(h.cds[1])} E${fmtCd(h.cds[2])} R${fmtCd(h.cds[3])}`
        : `DJ DOWN — press G to revive (€${h.reviveCost})`;
    const build = controls.buildModeName();
    const status =
      `€${host.cash}  gear ${host.gear}  headroom ${host.headroomUsed}/${host.headroomCap}` +
      `  tier ${host.tier}  heat ${host.heat}  ${host.night ? '🌙 night' : '☀ day'}\n` +
      `${heroLine}\n` +
      `selected ${controls.selected.size}${controls.attackMovePending ? '  [A-MOVE]' : ''}${build ? `  [BUILD: ${build}]` : ''}`;
    hud.textContent = touch
      ? status
      : `World of TechnoCraft — ${backend}  fps ${engine.getFps().toFixed(0)}  tick ${host.tick}${isReplay ? '  [REPLAY]' : ''}\n` +
        status +
        `\nRMB move/harvest · A attack-move · B build · T/Y/U/I train · V tier up · Q/W/E/R hero · G revive · P door · M mute · ? help`;
  });

  window.addEventListener('resize', () => engine.resize());

  // Test/debug hook (harmless in production; used by headless checks).
  (window as unknown as Record<string, unknown>).__wotc = { views, controls, host };
}

void boot();
