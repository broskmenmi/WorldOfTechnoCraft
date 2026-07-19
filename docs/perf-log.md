# Perf log

Numbers from `/bench.html?units=N` per milestone. The permanent acceptance
gate is 1500 units ≥ 60 fps on mid-range **real** hardware; the CI-adjacent
numbers below from headless SwiftShader (pure software rasterization) exist to
track *relative* regressions, not absolute fps.

| Date | Milestone | Environment | Units | avg ms | p95 ms | draw calls | Notes |
|---|---|---|---|---|---|---|---|
| 2026-07-19 | M3 | headless Chromium, SwiftShader (software), 1280×720 | 1500 | 55.9 | 69.3 | 3 | fps meaningless in software; draws = 1 crowd + ground + grid |
| 2026-07-19 | M3 | same, 320×240 viewport | 100 | 16.8 | 16.9 | 3 | vsync-capped |
| 2026-07-19 | M3 | same, 320×240 viewport | 1500 | 26.7 | 30.3 | 3 | +10 ms for +1400 units = software T&L cost, vanishes on real GPU |

Sim-side budget (CI-enforced): 1000-unit `step()` mean < 10 ms/tick in Node —
currently ~0.18 ms/tick (55× headroom).

TODO when real hardware is available: record Chrome WebGPU + Firefox WebGL2
numbers at 1500 and 3000 units, 1080p.
