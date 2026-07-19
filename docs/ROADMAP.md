# Roadmap — v1 Single-Player Skirmish

> **Status (2026-07-19):** M0–M7 complete; M8/M9 core complete (minimap,
> synthesized soundtrack, barks, Legion wave AI, Sunrise win/lose, replays).
> Remaining for v1: M10 polish (balance pass, silhouette pass, loading screen,
> deploy + `docs/playtest.md` run) plus M8 leftovers (BPM fader presets,
> selection/build panel in the HUD, F3 perf HUD).

V1 target: a full single-player skirmish — **Konkrete Door-State** (player, defensive club theocracy) vs **Legion of Rotterdam** (AI gabber rush) — survive to Sunrise with your Dancefloor alive; lose if The Door falls.

## V1 content subset

- **Player roster (Door-State):** Clubgoer (worker), Bouncer (melee tank), Strobe Acolyte (ranged), Monk of the Loop (healer), Cable Guy (builder), Resident DJ (hero, channels The Drop). Buildings: The Door (HQ + Door Policy stance), Dancefloor (Vibe), Bar (Cash), Speaker Stack (vision/slow tower), Booth (tech), Smoke Machine (turret).
- **AI roster (Legion):** Gabber, Hakken Bruiser, Uptempo Screamer, Sound Wagon; Warcamp / Tent / Generator. Timed escalating waves + attack-move — "they only know forward."
- **Resources:** **Vibe** (dancers on Dancefloors generate it; abilities, elites and The Drop spend it) and **Cash** (Bar income; buildings/units).
- **Neutral threat:** **Heat** — noise-complaint meter fed by speakers and Drops; thresholds spawn Police Raid squads at map edges. The anti-turtle tax.
- **Win/lose:** survive to Sunrise (scored by peak Vibe); optional early win by destroying the Warcamp.

## Milestones

Each milestone is a mergeable state with a "see it working" check.

- **M0 — Scaffold.** Workspace, configs, determinism lint firewall, CI, `_headers`, docs. *Check: a decimal literal in `packages/sim/src` fails `pnpm lint`.*
- **M1 — Determinism skeleton** (before any rendering). Fixed-point kit (`fp.ts`), mulberry32 PRNG, FNV-1a hashing, bitecs world with integer components, pure `step()`, command union + binary serialize, checksums every 10 ticks, snapshot serialize/restore, headless CLI (`cli/run.ts`) + `cli/replay-diff.ts`, soak fixture. *Check: CI runs the fixture twice and checksum streams match; snapshot-restore mid-run converges with the straight run.*
- **M2 — Worker + render shell.** 20 Hz worker tick, Transferable snapshots, Babylon boot (WebGPU badge, `?gl=webgl2` forces fallback), RTS top-down camera, 50 random-walking entities rendered as interpolated boxes. *Check: 60 fps render / 20 Hz sim, worker thread visibly ticking in DevTools.*
- **M3 — Crowd proof.** Thin instances + procedurally baked vertex-animation textures (idle/walk/dance on primitive rigs), per-instance team color + anim phase. *Check: `/bench.html?units=1500` ≥ 60 fps, ≤ ~10 draw calls for the crowd. This page is the permanent perf canary.*
- **M4 — Control UX spine.** Drag-box select, orders as real Commands through the worker round-trip, selection rings, control groups 0–9, shift-queue, double-click select-type, instant local acknowledgment (flash + blip) on command issue.
- **M5 — Pathfinding at scale.** 256×256 walkability grid, HPA* over 16×16 clusters, amortized cached flow-field tiles, fixed-point separation steering. *Check: 200 units through a choke, checksum-stable, headless p95 < 8 ms/tick.*
- **M6 — Combat + fog.** Spatial-hash target acquisition, attack-move, death; Bass Coverage vision → per-player fog grid → R8 texture with blur; instanced health bars. *Check: combat soak fixture stays CI-green.*
- **M7 — Economy + buildings.** Data-driven defs: Vibe/Cash income, build placement + construction, production queues + rally points, Door Policy stance, Heat accumulator + raid spawns. *Check: full tech tree buildable by mouse from one HQ + 3 Clubgoers; editing a cost in `@wotc/data` hot-reloads.*
- **M8 — HUD, minimap, audio.** DOM HUD (resources, Sunrise clock, Heat meter, selection/build panel), canvas minimap with fog + camera control; 4 bar-aligned OGG stems mixed via WebAudio gains, beat clock driving UI/dance pulses, BPM fader presets (0.5×/1×/1.5× — pitch shift embraced as the joke), zzfx SFX, bark toasts with cooldowns.
- **M9 — Skirmish.** Legion wave AI as a sim system, Sunrise timer + sky ramp, win/lose screens with Vibe score, replay = `{seed, mapId, commands[]}` download + `?replay=` playback, save/load = snapshot + command tail. *Check: a replay's final checksum equals the live game's logged checksum.*
- **M10 — Polish + ship.** Balance via data files only, unit silhouette pass (still primitives through the VAT pipeline), loading/error screens, deploy, run `docs/playtest.md`. *Check: deployed URL plays a full skirmish at 60 fps in Chrome (WebGPU) and Firefox (WebGL2) with 800+ live units late-game.*

**Placeholder-art rule:** all units are primitive compositions run through the same thin-instance + VAT pipeline real models will use later. Gameplay never blocks on art.

## Verification

- **CI on every push:** typecheck + lint (determinism firewall) + unit tests + run-twice-and-diff checksum job + snapshot-restore convergence + Node sim perf budget (1000-unit `step()` mean < 10 ms).
- **Replay round-trip test:** scripted match through the real command pipeline → export replay → re-simulate → final checksums equal.
- **Manual:** per-milestone checks above; `/bench.html` overlay numbers logged in `docs/perf-log.md`; F3 runtime HUD (tick ms, frame ms, snapshot bytes); Node-vs-browser checksum cross-check; `docs/playtest.md` script at M10.

## Explicitly after v1

Multiplayer (deterministic lockstep over WebSocket via a dumb relay container — the sim is already lockstep-shaped), more factions from the world bible, real art/GLB models, map editor, ranked anything.
