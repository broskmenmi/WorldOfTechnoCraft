# World of TechnoCraft

A satirical real-time strategy game about techno culture, running in the browser at desktop-class performance. Defend your club until sunrise against the gabber horde. The door decides who gets in. The door does not explain itself.

> *"Heute leider nicht."* — a Door Oracle, to your mission-critical reinforcements

## Stack

- **Renderer:** [Babylon.js 8](https://www.babylonjs.com/) — WebGPU-first, automatic WebGL2 fallback; thin instances + baked vertex animation textures for 1000+ animated units at 60 fps.
- **Simulation:** [bitecs](https://github.com/NateTheGreatt/bitECS) ECS, all-integer fixed-point math, 20 Hz deterministic tick in a Web Worker. Every player action is a serializable command — the same struct is the replay format, the save format, and (later) the lockstep network payload.
- **Tooling:** TypeScript, Vite, Vitest, ESLint with a determinism firewall (no floats, no wall-clock, no `Math.random` in the sim — enforced by lint).

See [docs/TECH_STRATEGY.md](docs/TECH_STRATEGY.md) for the full technical strategy, [docs/WORLD_BIBLE.md](docs/WORLD_BIBLE.md) for the world, factions, and joke style guide, and [docs/ROADMAP.md](docs/ROADMAP.md) for milestones.

## Repo layout

| Package | Purpose |
|---|---|
| `packages/sim` | `@wotc/sim` — the deterministic game core. Depends on bitecs only. No DOM, no floats, no time. Headless CLI for soak runs and replay diffing. |
| `packages/data` | `@wotc/data` — typed, integer-only unit/building/faction stats and all satire text (barks, flavor). Balance and jokes iterate here without touching engine code. |
| `packages/game` | `@wotc/game` — the Vite app: Babylon renderer, sim worker host, input, DOM HUD, WebAudio. |

## Commands

```bash
pnpm install
pnpm dev          # run the game locally
pnpm typecheck    # tsc across all packages
pnpm lint         # includes the sim determinism firewall
pnpm test         # vitest unit tests
pnpm build        # production build of packages/game
```

## Determinism, briefly

The sim is a pure function: `step(world, commandsForTick)`. Same seed + same command log ⇒ bit-identical state on every machine, verified by FNV-1a checksums every 10 ticks. CI runs every soak fixture twice and diffs the checksum streams; a replay is just `{seed, mapId, commands[]}`.
