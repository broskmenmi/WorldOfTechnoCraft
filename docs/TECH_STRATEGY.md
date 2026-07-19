# Browser RTS — Unified Technical Strategy (v1.0, July 2026)

Synthesis of four research tracks: rendering engines, web-platform capabilities, RTS engine architecture, and multiplayer networking.

---

## 1. Recommended Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | **TypeScript** (Rust/WASM as a proven escape hatch, not a starting point) | Fastest iteration; bitecs TypedArray sim comfortably handles 1,000–3,000 units at 20 Hz; port hot systems to WASM only if profiling demands it |
| Renderer | **Babylon.js 8, WebGPU-first with automatic WebGL2 fallback** | Most mature JS WebGPU backend: native WGSL shaders since 8.0 (Mar 2025), compute API, render bundles, and a *turnkey* crowd path — thin instances + Baked Vertex Animation Textures proven at **1000+ independently animated skeletal units @ 60 fps** ([Babylon 8.0](https://blogs.windows.com/windowsdeveloper/2025/03/27/announcing-babylon-js-8-0/), [thousands of animated entities](https://babylonjs.medium.com/creating-thousands-of-animated-entities-in-babylon-js-ce3c439bdacf), [WebGPU docs](https://doc.babylonjs.com/setup/support/webGPU)). Runner-up: three.js r171+ WebGPURenderer/TSL if ecosystem (r3f, three-mesh-bvh, recast-navigation-js) outweighs Babylon's turnkey crowd rendering — but crowd skinning there is DIY |
| Presentation | **2.5D** — full 3D renderer, RTS-locked top-down camera | Sweet spot: one rigged model serves all angles (vs 8-dir sprite sheets), camera constraints bound culling/LOD/overdraw, FoW is a simple projected texture. Genre standard since SC2/AoE4 |
| Simulation | **bitecs ECS**, all-integer **fixed-point** math (OpenRA-style: 1024 sub-units/cell, integer sqrt, sine table, mulberry32 PRNG), fixed **15–20 Hz tick** in a **Web Worker** | bitecs is the fastest JS ECS (~3× miniplex, ~40× ecsy in [noctjs bench](https://github.com/noctjs/ecs-benchmark)); its `Int32Array` SoA storage triples as deterministic state, checksum input, and snapshot/replay format. Fixed-point gives a lintable rule: "no floats in `/sim`" |
| Netcode | **Deterministic lockstep** over **WebSocket** via a **dumb relay server** (~200-line Node/Go: rooms by join-code, order + forward turn bundles, enforce turn deadlines) | The genre gold standard (AoE "[1500 Archers](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)", SC2, Factorio, OpenRA): bandwidth is O(commands), not O(units). At 100–250 ms command turns, TCP HoL blocking is tolerable; WebTransport (Baseline since Safari 26.4, Mar 2026 — [caniuse](https://caniuse.com/webtransport)) is a later drop-in behind a transport abstraction. Skip P2P: TURN fallback *is* a relay, so run the relay and gain timing authority + replay archiving |
| Pathfinding | **HPA\*** (16×16 clusters) for corridors + **flow-field tiles** per group order, cached + amortized, + separation steering — **CPU, in-sim** | The AoE4/SupCom2 production architecture ([AoE4 GDC 2022](https://www.gdcvault.com/play/1027659/Pathing-in-Age-of-Empires), [Game AI Pro ch.23](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf)). Cost is per-order, not per-unit |
| UI/HUD | **DOM/HTML overlay** over the canvas (in-canvas only for world-space elements: health bars, selection rings) | Single biggest "feels native" win: crisp text, accessibility, fast iteration |
| Hosting | Static client on Cloudflare Pages/Netlify (custom headers via `_headers`); relay on a **$5–10 VPS or Fly.io as a plain container** | Post-Hathora lesson (below): no proprietary game-server platform lock-in. itch.io viable for demos |
| Eliminated | Godot 4 web (WebGL2-only, single-threaded WASM, 30–50 MB), Unity 6 Web (WebGPU experimental, 20–60 MB builds), Unreal (no WASM target; Pixel Streaming economics don't fit), Phaser (outclassed), Pixi (only if pivoting to pure-2D sprites) | Per rendering report rankings |

### Resolved contradictions between reports

1. **WebGPU availability: ~80–85% (Report 1, caniuse) vs ~70% (Report 2, byteiota).** The sources measure differently (browser-version share vs. usable-in-practice incl. GPU blocklists, Firefox Linux/Android gaps). Planning number: **70–85%, treat as "most but not all"** — the conclusion is identical either way: **WebGL2 fallback is mandatory** (WebGL2 ≈ 97%+).
2. **GPU compute for fog of war / pathfinding (Report 1) vs deterministic CPU sim (Reports 3–4).** These conflict: lockstep requires bitwise-identical results across machines, and GPU compute results are **not** cross-GPU deterministic. Resolution: **anything gameplay-affecting (visibility grid, flow fields, combat) stays in the CPU fixed-point sim.** WebGPU compute is used only for render-side cosmetics: fog texture blur/decay, GPU culling + `drawIndirect`, VAT skinning, particles. Report 1's compute wins still apply — just on the presentation side of the wall.
3. **"Go single-threaded and skip COOP/COEP" (Report 4) vs "sim in a Worker with SharedArrayBuffer" (Report 3).** Resolution: run the sim in a **plain Web Worker with postMessage/Transferables — no SAB required**, which gets tab-throttle immunity and a free main thread without any header requirements. But since we control hosting, **ship COOP/COEP headers from day one anyway** (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`; `credentialless` is not supported in Safari), unlocking SAB zero-copy sharing and `measureUserAgentSpecificMemory()` later. Note COEP does **not** block WebSocket/WebRTC, so multiplayer is unaffected.
4. **Renderer choice (Report 1: Babylon; Report 3's sketch: "Pixi/Three/WebGPU").** Not a real conflict — Report 3's sim architecture is renderer-agnostic. Babylon.js 8 wins on Report 1's deeper comparison (crowd VAT path + Recast crowd plugin + best WebGPU maturity).
5. **Input delay: 2 turns (Report 3) vs 2–3 turns (Report 4).** Non-material: start at execution turn = current + 2, make turn length adaptive à la AoE.

---

## 2. Architecture Overview

```
┌────────────── Main thread ───────────────┐   ┌──────── Web Worker ───────────┐
│ Input → serializable Command objects     │   │  SIM CORE (deterministic)     │
│ Babylon.js renderer (WebGPU→WebGL2)      │◄──┤  bitecs world (Int32Array SoA)│
│  - thin instances + baked VAT crowds     │msg│  fixed-point, seeded PRNG     │
│  - render bundles for terrain/statics    │/SAB  systems: orders → HPA*/flow │
│  - interpolates prev/curr snapshots      │   │  fields → movement → combat → │
│  - FoW R8 texture upload + blur shader   │   │  economy → visibility →       │
│ DOM overlay: HUD, minimap, ctrl groups   │   │  FNV-1a checksum (every 10t)  │
└───────────────┬──────────────────────────┘   └──────────────┬────────────────┘
                │ {tick, playerId, cmd, unitIds[], target}     │
                ▼                                              │
        wss:// WebSocket ──── relay server (VPS container) ────┘
        relay = command sequencer + turn clock + replay archiver
```

Key mechanics, each backed by a shipped-game precedent:

- **Loop**: fixed sim tick (15–20 Hz; SC2 runs 16–22.4 Hz, Factorio 60) with accumulator + catch-up cap; render at rAF with **interpolation, never extrapolation** ([Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)). Command turns of ~100–200 ms group 2–4 ticks; adaptive turn length per AoE. Worker keeps ticking when the tab is backgrounded.
- **Commands are data**: every UX action compiles to `{tick, playerId, type, unitIds[], target}` — the same struct is the network payload, the replay format, and the sim input. UI never mutates sim state. Single-player = lockstep with zero latency.
- **Determinism regime**: fixed-point ints only in `/sim`; ESLint ban on `Math.*` (except int-safe ops), `Math.random`, `Date`; seeded PRNG; deterministic iteration order and tie-breaking by entity ID. JS `+ - * /` and `Math.sqrt` on doubles are IEEE-deterministic, but `Math.sin/cos/pow` are **not** cross-engine ([Rune](https://developers.rune.ai/blog/making-js-deterministic-for-fun-and-glory)); WASM floats are deterministic except NaN payloads and relaxed-SIMD. Fixed-point sidesteps all of it.
- **Desync tripwire**: FNV-1a/xxhash over component arrays every ~10 ticks, exchanged between clients; mismatch → alarm + auto bug report. AoE, Factorio ([FFF-188](https://factorio.com/blog/post/fff-188)), and OpenRA all report determinism bugs as the dominant lockstep engineering cost — **build this tooling before features**.
- **Replays = the netcode**: map seed + settings + command stream + checksum stream + engine/data version hash (replays break on any sim change). Playback feeds commands through the identical sim; periodic bitecs buffer snapshots (~every 30 s) enable seeking. This is exactly SC2's model ([sc2reader](https://sc2reader.readthedocs.io/en/latest/articles/whatsinareplay.html)).
- **Fog of war**: per-player `Uint8Array` grid in-sim (unexplored/explored/visible), updated every 4–8 ticks by stamping sight-radius offset lists; gameplay (targeting, ghost buildings) reads it deterministically. Renderer uploads the local grid as a small R8 texture (256×256 ≈ 64 KB) and blurs/lerps in-shader ([jdxdev](https://www.jdxdev.com/blog/2022/06/08/rts-fog-of-war/)).
- **Latency masking**: instant acknowledgment sound + selection flash on click while the command waits 2 turns — the AoE trick.
- **Control UX (SC2-era table stakes)**: drag-box (military priority on mixed drags), control groups 0–9, shift-queue waypoints, attack-move, patrol/hold/stop, rally points, double-click select-all-of-type, unlimited selection.

---

## 3. Capability Checklist — Browser vs. Desktop

### What we get (≈90–95% of desktop for this genre)
- **Rendering**: WebGPU in all major engines — Chrome/Edge 113+ (Apr 2023), Firefox 141+ (Win, Jul 2025)/147 broadly, Safari 26 (Sept 2025). ~2.3× draw-call throughput vs WebGL at 10k+ objects; compute shaders (100k particles <2 ms vs 10k @ 30 ms on CPU/WebGL); render bundles; indirect draw ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers), [impl status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)).
- **Compute (CPU)**: WASM within ~1.5–2.5× native; wasm SIMD universal; threads via Workers+SAB (with COOP/COEP); WASM 3.0 official (Memory64 in Chrome 133+/Firefox 134+ — but stay wasm32 unless >4 GB needed, Memory64 has a bounds-check perf tax).
- **Input**: Pointer Lock universal; `unadjustedMovement` (raw mouse) Chromium-only; Gamepad API universal (polling); `KeyboardEvent.code` for layout-independent hotkeys everywhere.
- **Audio**: AudioWorklet on the real-time thread, 128-frame quanta (2.67 ms @ 48 kHz), sample-accurate scheduling, ~5–20 ms desktop output latency; read `baseLatency`/`outputLatency` for sync. (Relevant given the project's techno/music theming.)
- **Storage**: OPFS with sync access handles in workers — fastest platform storage, ~2×+ IndexedDB for binary ([web.dev OPFS](https://web.dev/articles/origin-private-file-system)); quota up to ~60% of disk (Chromium); use for asset caches + replays.
- **App feel**: PWA install (Chrome/Edge; Firefox 143+ desktop; Safari Add-to-Dock), fullscreen, Wake Lock, OffscreenCanvas (renderer in a worker — Safari 17+ for WebGL-in-worker). Plus the web's own superpower: zero-install, always-latest, one-click join links.

### What we sacrifice
| Desktop capability | Browser reality | Impact on this RTS |
|---|---|---|
| Kernel anti-cheat | Impossible by design | Low for v1 — lockstep + command validation + replays; maphacks unpreventable (see Risks) |
| Raw UDP sockets | WebSocket / WebRTC DataChannel / WebTransport only | Low — lockstep cadence tolerates TCP; WebTransport now Baseline |
| Arbitrary filesystem | OPFS + user-mediated pickers (full dir access Chromium-only) | Low — OPFS covers saves/replays/caches |
| Exclusive fullscreen, refresh-rate/VRR control, guaranteed HDR | Borderless-equivalent only | Cosmetic |
| Esc/Tab as game keys in fullscreen | Keyboard Lock is Chromium-only | Minor UX asymmetry on Firefox/Safari |
| Memory guarantees | Tab can be OOM-killed silently; ~4 GB wasm32 ceiling | Treat memory like a console budget |
| Mesh shaders / RT cores | Not in WebGPU yet | Irrelevant for 2.5D RTS |
| Background operation / global hotkeys | rAF stops when backgrounded (workers keep running) | Solved: sim in Worker |
| Safari storage eviction | ITP wipes storage after 7 days' non-use unless installed | Warn users / cloud saves |

### Hosting header checklist (deploy-blocking, get right on day one)
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp     # credentialless not in Safari
Cross-Origin-Resource-Policy: cross-origin     # on every asset we serve
Content-Type: application/wasm                 # streaming compile
Content-Encoding: br                           # precompressed
Cache-Control: public, max-age=31536000, immutable   # hashed assets
```
Under `require-corp`, every cross-origin subresource needs CORP/CORS — third-party embeds and some OAuth popups break; test login flows. Multiplayer must be `wss://` (mixed-content rules).

---

## 4. Risks and Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Desyncs** — the universally-reported #1 lockstep cost (AoE, Factorio, OpenRA) | High | Fixed-point + lint ban in `/sim`; per-10-tick state hashes exchanged live; checksum stream embedded in every replay so any user replay is a desync repro; build the diff/repro tooling *first* |
| 2 | **WebGPU gaps/inconsistency** (Firefox Linux/Android lag; driver variance; pipeline-compile jank) | Medium | WebGL2 fallback via Babylon's dual backend; renderer toggle in settings; pipeline warm-up + caching; keep FoW/pathfinding sim-side so fallback loses only eye-candy |
| 3 | **Maphacks** — lockstep clients hold full state; fog is cosmetic locally | Accepted for v1 | Don't fight it pre-PMF. Command validation in-sim blocks state cheats structurally; replays + desync hashes give detection. True fix (server-authoritative sim + interest management) is a documented future fork, viable at ~100–300 units |
| 4 | **Platform lock-in** — Hathora shut down May 5, 2026 after Fireworks AI acqui-hire, killing Stormgate's (an actual RTS!) multiplayer ([GamesBeat](https://gamesbeat.com/hathora-acquired-will-exit-game-infrastructure-biz-and-hand-over-customers-to-nitrado/)) | High (existential, cheap to avoid) | Relay is a plain container movable to any VPS in an afternoon; no proprietary SDK in game code; Colyseus (OSS, cloud from $15/mo) or Nakama (Apache-2.0, self-host) only as optional conveniences |
| 5 | **TS sim hits its ceiling** (>~3k active units; pathfinding is the budget item) | Medium | Amortize flow-field integrations (K tiles/tick, cached per SupCom2's tile trick); if still short, port the *whole* sim to Rust/WASM behind one `tick(inputs)` boundary with zero-copy TypedArray views — bitecs' flat buffers make this a planned migration, not a rewrite |
| 6 | **COOP/COEP breakage** (OAuth popups, third-party embeds, static hosts without headers) | Medium | Host on Cloudflare Pages/Netlify with `_headers`; audit all cross-origin subresources; `coi-serviceworker` shim only as last resort; itch.io SAB checkbox exists but prefer the no-SAB worker design |
| 7 | **Lockstep UX failure modes** (slowest-client pacing, lag-switch stalls, late-join) | Medium | Adaptive turn length (AoE); server-enforced turn timeouts + drop/pause policy; late-join deferred (needs full-state snapshot serialization — bitecs buffers make it feasible later) |
| 8 | **Replay/save version fragility** — any balance change breaks old replays | Low | Version hash in replay header; accept breakage in beta, archive sim builds if it matters later |
| 9 | **Tab throttling / OOM kill** | Low | Sim in Worker (keeps ticking); autosave snapshots to OPFS; reconnect-to-relay flow with turn-buffer replay |

---

## 5. Suggested v1 Scope

**Phase 0 — Determinism skeleton (before any gameplay)**
- bitecs world + fixed-point math kit (int sqrt, sine table, mulberry32), 20 Hz tick in a Worker, command-queue API, FNV-1a checksum + snapshot serialize/restore, headless sim runner + replay-diff CLI. *This is ~90% of the lockstep work and nearly impossible to retrofit.*

**Phase 1 — Single-player vertical slice**
- One map (256×256 grid), one faction, ~6 unit types + ~6 buildings, basic economy (1–2 resources, gather/build/produce).
- Rendering: 2.5D Babylon.js scene, WebGPU + WebGL2 fallback, thin instances + baked VAT (target: **1,000 animated units @ 60 fps on mid-range hardware** — demonstrated feasible), render bundles for terrain, DOM HUD + minimap.
- Pathfinding: HPA* + lazy cached flow-field tiles + separation steering.
- FoW: sim-side Uint8Array grid + R8 texture render with blur/lerp.
- Full control UX baseline (drag-box, control groups, shift-queue, A-move, rally points) with instant acknowledgment feedback.
- One scripted skirmish AI. Replays + saves via the command log (free from Phase 0).

**Phase 2 — Multiplayer**
- 1v1 + 2-player co-op vs AI, lockstep over WebSocket, dumb relay container on a VPS/Fly.io, join codes (no accounts, no matchmaking).
- Command turns ~150 ms, execute at +2 turns, adaptive length; live checksum exchange; server archives replays.
- Transport abstraction (`send(turnBundle)` / `onTurn(cb)`) so WebTransport datagrams-with-redundant-inputs or geckos.io slot in later without touching game code.
- Data formats sized for 8 players; tested at ≤4.

**Explicitly out of v1**: ranked ladder/matchmaking/accounts, anti-maphack, late-join/host-migration, >4 players, map editor, mobile, Rust/WASM sim port, Steam wrapper (Electron/Tauri later shares ~99% of code), GPU-compute gameplay systems.

**Success criteria**: 1,000 units at 60 fps render / 20 Hz sim on mid-range 2026 hardware in Chrome + Firefox + Safari (WebGL2 path included); a 4-player-format 1v1 completing 30+ minutes with zero desyncs; any desync reproducible from the user's replay file alone.
