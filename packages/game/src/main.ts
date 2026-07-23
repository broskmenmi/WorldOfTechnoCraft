import { buildMap, CYCLE_TICKS, DAY_TICKS, decodeReplay, encodeReplay, type MapId } from '@wotc/sim';
import { Controls } from './input/controls.ts';
import { createGameEngine } from './render/engine.ts';
import { createGameScene } from './render/scene.ts';
import { UnitRenderer } from './render/units.ts';
import { BuildingRenderer } from './render/buildings.ts';
import { Effects, type DamageEvent } from './render/effects.ts';
import { Dressing } from './render/dressing.ts';
import { SimHost, type UnitView } from './simHost.ts';
import { Minimap } from './ui/minimap.ts';
import { BarkFeed } from './ui/barks.ts';
import { CommandCard } from './ui/commandCard.ts';
import { Objectives } from './ui/objectives.ts';
import { setupHelp } from './ui/help.ts';
import { ACCENT, CHROME_BG, CHROME_BORDER, DIM, FONT, GOLD, setOverlayOpen, TEXT } from './ui/theme.ts';
import { TechnoEngine } from './audio/techno.ts';
import { sfx } from './audio/sfx.ts';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { BUILDINGS_BY_ID, NODES_BY_ID, UNITS_BY_ID } from '@wotc/data';

const MAP_ID: MapId = 'skirmish02';
const MAP_CELLS = 256;
const REPLAY_KEY = 'wotc-replay';

function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

interface TopBar {
  resources: HTMLSpanElement;
  hero: HTMLSpanElement;
  debug: HTMLSpanElement;
  toggleDebug(): void;
}

/** Slim full-width top bar: the only chrome at the top of the screen. */
function makeTopBar(): TopBar {
  const bar = document.createElement('div');
  bar.style.cssText =
    `position:fixed;top:0;left:0;right:0;height:30px;display:flex;align-items:center;` +
    `gap:18px;padding:0 52px 0 12px;background:${CHROME_BG};border-bottom:${CHROME_BORDER};` +
    `font:${FONT};color:${TEXT};pointer-events:none;white-space:nowrap;overflow:hidden`;
  const resources = document.createElement('span');
  const hero = document.createElement('span');
  hero.style.color = DIM;
  const debug = document.createElement('span');
  debug.style.cssText = `margin-left:auto;color:${DIM};display:none`;
  bar.append(resources, hero, debug);
  document.getElementById('hud')?.appendChild(bar);
  return {
    resources,
    hero,
    debug,
    toggleDebug() {
      debug.style.display = debug.style.display === 'none' ? 'inline' : 'none';
    },
  };
}

function showMatchEnd(won: boolean, isReplay: boolean): void {
  setOverlayOpen(true);
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'flex-direction:column;background:#000a;pointer-events:auto;font-family:monospace;text-align:center;z-index:20';
  el.innerHTML = won
    ? `<div style="font-size:42px;color:${GOLD}">THE WARCAMP LOST THE AUX</div>
       <div style="font-size:16px;color:#e8e8e8;margin:12px">The council shut down their last structure. The Legion shrugged,<br>hugged everyone within reach, and wandered off to find the afterparty.<br>The city dances to your sound now.</div>`
    : `<div style="font-size:42px;color:#ff5f5f">THE COUNCIL SHUT YOU DOWN</div>
       <div style="font-size:16px;color:#e8e8e8;margin:12px">Every permit revoked. The Legion renamed the venue "Amsterdam?"<br>and left a thank-you note. Nobody was hurt. Everyone is furious.</div>`;
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

async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
  const { engine, backend } = await createGameEngine(canvas);
  const grid = buildMap(MAP_ID);
  const game = createGameScene(engine, MAP_CELLS, grid);
  const topBar = makeTopBar();

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
  const unitRenderer = new UnitRenderer(game.scene);
  const buildingRenderer = new BuildingRenderer(game.scene);
  const effects = new Effects(game.scene);
  const dressing = new Dressing(game.scene, grid, game.ground, MAP_CELLS);
  const card = new CommandCard(controls, host, touch);
  const objectives = new Objectives(isReplay);
  unitRenderer.onDeath = (v) => {
    if (v.building) sfx.raze();
    else sfx.death();
  };
  setupHelp(touch);

  // Hover label (desktop): name + vibe for whatever is under the cursor.
  const hoverEl = document.createElement('div');
  hoverEl.style.cssText =
    `position:fixed;display:none;background:${CHROME_BG};border:${CHROME_BORDER};` +
    `border-radius:5px;padding:3px 8px;font:${FONT};color:${TEXT};pointer-events:none;z-index:5`;
  document.getElementById('hud')?.appendChild(hoverEl);

  window.addEventListener('pointerdown', () => audio.start(), { once: true });
  window.addEventListener('keydown', (e) => {
    audio.start();
    if (e.code === 'KeyM') audio.toggleMute();
    if (e.code === 'F3') {
      e.preventDefault();
      topBar.toggleDebug();
    }
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
  const prevHp = new Map<number, number>();
  let prevCds: [number, number, number, number] = [0, 0, 0, 0];
  let prevLevel = 1;

  engine.runRenderLoop(() => {
    const now = performance.now();
    host.units(now, views);
    controls.setViews(views);
    if (host.fog && host.fog !== lastFog) {
      lastFog = host.fog;
      game.updateFog(host.fog);
    }

    // Fog-visible subset for the renderers (same rule the scene uses).
    const fog = host.fog;
    const visible = fog
      ? views.filter((v) => {
          if (v.player === 0) return true;
          const ci = Math.floor(v.x) + Math.floor(v.y) * MAP_CELLS;
          return v.building || v.node ? fog[ci] !== 0 : fog[ci] === 2;
        })
      : views;

    // Clash events from vibe diffs (visible entities only — fog stays honest).
    const damage: DamageEvent[] = [];
    for (const v of visible) {
      const prev = prevHp.get(v.eid);
      if (prev !== undefined && v.hp < prev) {
        damage.push({ victim: v, amount: prev - v.hp });
        if (v.player === 0) minimap.ping(v.x, v.y);
      }
    }
    prevHp.clear();
    for (const v of views) prevHp.set(v.eid, v.hp);
    if (damage.length > 0) (damage.some((d) => d.victim.building) ? sfx.hit : sfx.zap)();

    game.updateUnits(views, now / 1000, host.fog);
    unitRenderer.update(visible, now, audio.beatPhase());
    buildingRenderer.update(visible);
    effects.update(damage, visible, now);
    dressing.pulse(audio.beatPhase(), host.night);
    game.updateSelection(views, controls.selected);
    minimap.update(views, host.fog, now);
    card.update(views);
    if (objectives.update(visible, host, now)) sfx.levelUp();
    game.scene.clearColor = skyAt(host.tick);
    game.scene.render();

    // Hover label (skip on touch — there's no hover).
    if (!touch) {
      const p = controls.pointer;
      const hov = p.y > 36 ? controls.viewAt(p.x, p.y) : null;
      if (hov) {
        const def = hov.node
          ? NODES_BY_ID.get(hov.kind)
          : hov.building
            ? BUILDINGS_BY_ID.get(hov.kind)
            : UNITS_BY_ID.get(hov.kind);
        hoverEl.textContent = hov.node
          ? `${def?.name ?? '?'} — ${hov.progress}% left`
          : `${def?.name ?? '?'} · vibe ${hov.hp}/${hov.maxHp}`;
        hoverEl.style.display = 'block';
        hoverEl.style.left = `${Math.min(p.x + 14, window.innerWidth - 180)}px`;
        hoverEl.style.top = `${p.y + 16}px`;
      } else {
        hoverEl.style.display = 'none';
      }
    }

    // Hero moments: ability casts, THE DROP, level-ups.
    const hs = host.hero;
    const heroView = views.find((v) => v.eid === hs.eid);
    if (heroView) {
      if (hs.cds[0] > prevCds[0] + 60) {
        sfx.airhorn();
        effects.ring(heroView.x, heroView.y, 2.5, [1, 0.9, 0.4]);
      }
      if (hs.cds[3] > prevCds[3] + 600) {
        sfx.drop();
        effects.dropFlash();
        effects.ring(heroView.x, heroView.y, 7, [1, 1, 1]);
      }
      if (hs.level > prevLevel) {
        sfx.levelUp();
        effects.ring(heroView.x, heroView.y, 3, [0.7, 0.55, 1]);
      }
      prevLevel = hs.level;
    }
    prevCds = [...hs.cds] as [number, number, number, number];

    if (host.raidsSpawned > lastRaids) {
      lastRaids = host.raidsSpawned;
      barks.event('raidIncoming');
    }
    // Music intensity: hostiles near own buildings = a clash is brewing.
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
      sfx.stinger(host.matchState === 1);
      if (!isReplay) localStorage.setItem(REPLAY_KEY, encodeReplay(host.buildReplay()));
      showMatchEnd(host.matchState === 1, isReplay);
    }

    // Top bar text.
    const idle = controls.idleWorkerCount();
    const h = host.hero;
    topBar.resources.innerHTML =
      `<b style="color:${GOLD}">€${host.cash}</b>  ⚙${host.gear}  ` +
      `👥${host.headroomUsed}/${host.headroomCap}  tier ${host.tier}  ` +
      `🔥${host.heat}  ${host.night ? '🌙' : '☀'}` +
      (idle > 0 ? `  <span style="color:${ACCENT}">💤${idle} idle (,)</span>` : '');
    topBar.hero.textContent =
      h.eid !== 0
        ? `DJ lvl ${h.level} · hype ${h.hype}/${h.hypeMax}${isReplay ? ' · [REPLAY]' : ''}`
        : `DJ went home — G to re-book (€${h.reviveCost})${isReplay ? ' · [REPLAY]' : ''}`;
    topBar.debug.textContent = `${backend} · fps ${engine.getFps().toFixed(0)} · tick ${host.tick}`;
  });

  window.addEventListener('resize', () => engine.resize());

  // Test/debug hook (harmless in production; used by headless checks).
  (window as unknown as Record<string, unknown>).__wotc = { views, controls, host };
}

void boot();
