# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Bonser386/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Bonser386/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: the pre-token protocols in a sealed DefiLlama snapshot, ranked by an implied launch value priced off the live-token protocols already trading in their own category, with a farm plan for each one.

## The model (radar-2)

Implied value follows only from the snapshot's own figures, by comparables:

```
implied = round(tvl_usd x category multiple x growth multiplier x maturity multiplier)
```

- **Category multiple**: the median mcap / TVL of the live-token protocols in the same category, when at least 5 of them record both a market cap and a TVL; otherwise the global median over all 144 live-token protocols. Clamped to 0.05x–1.0x.
- **Growth multiplier**: `1 + clamp(change_7d, -60, 120) / 100 x 0.5`.
- **Maturity multiplier**: `0.6 + min(age_days, 1095) / 1095 x 0.4` (unknown age: 365 days).

No protocol name is special-cased. The board covers all 40 watchlist protocols plus the 160 highest-TVL pre-token protocols below the floor (200 rows). The dashboard shows the comparables table the multiples come from, a per-protocol breakdown, and a model sandbox that re-ranks the board live.

## Run

Node 22+, standard library only, no install, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

This writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Run it twice: both runs write identical bytes.

## Layout

- `main.ts` — entrypoint: reads the snapshot, scores the board, writes the outputs.
- `lib/model.ts` — the comparables model, the farm plans, the board and the dashboard data.
- `vendor/makefun-board.ts` — make.fun's dossier library (copied unchanged).
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No network, no framework.
- `screenshots/` — three screenshots of the dashboard: the board, a protocol's detail view, a filtered view.
