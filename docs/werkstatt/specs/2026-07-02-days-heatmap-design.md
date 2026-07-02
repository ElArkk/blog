# Days — neon segmented habit heatmap

**Date:** 2026-07-02
**Status:** approved (visual style chosen via mockups: neon, segmented liquid fill)
**Replaces:** the 3D tower motivation game (`/tower/`)

## Motivation

The 3D tower stopped motivating. Research (Habitica field study 2019; Lally 2010;
loss-aversion literature) says virtual-reward gamification decays fast, while an
honest visual history of missed vs. completed days plus loss aversion works. The
replacement is a GitHub-style year heatmap where misses are impossible to ignore
but a single miss never zeroes history.

## What it is

A single static page at `/days/` showing every day from `start` through the end
of the current calendar year as a grid: weeks as columns, 7 day-rows (Mon–Sun),
days after today rendered as faded "future" cells. Dark neon look (tower palette: `#0d0a18`/`#141020`
background, teal `#2de0a5`, cyan `#6ff5ff`, red `#ff3860`).

Each day cell is split vertically into one sliver per objective active that day
(segments). Rendering rules:

| Day state            | Cell                                                        |
| -------------------- | ----------------------------------------------------------- |
| full (`d === t`)     | all slivers lit bright cyan, outer glow                      |
| partial (`0<d<t`)    | `d` of `t` slivers lit teal, bottom-up, no glow              |
| missed (`d === 0`)   | dark red cell, red border, inset ember glow                  |
| paused (`null`)      | neutral dark slate                                           |
| future               | near-invisible                                               |

Hover: native `title` tooltip with ISO date and `d/t objectives`.

Header line in tower-HUD monospace style:
`POINTS <n>  STREAK <n>  BEST <n>  FULL <n>  PARTIAL <n>  MISSED <n>` plus
`[offline]` / `[demo]` tags when applicable.

## Data contract

Endpoint: Modal app in `~/git/modal-obsidian` (in scope). Renaming the deployed
function `tower_state` → `days_state` yields the new URL
`https://elarkk--obsidian-personal-days-state.modal.run` (Modal derives URLs
from function names). It serves:

```json
{
  "start": "2026-06-10",
  "days": [{ "d": 3, "t": 3 }, { "d": 1, "t": 4 }, { "d": 0, "t": 4 }, null],
  "streak": 8,
  "best": 23,
  "points": 287
}
```

- `days[i]` is the day `start + i`. `d` = objectives completed, `t` = objectives
  scheduled **on that day**. `null` = paused day.
- **Grading is frozen per day.** `t` is captured when the day is graded; adding
  an objective later changes only future days. History never re-grades.
- **Volume is rewarded.** Points = Σ `d`, so a 4/4 day banks more than a 3/3.
- `streak`/`best`/`points` are optional: the page computes them from `days` when
  absent (client-side `computeStats(days)`), so the backend change is minimal.

### Mechanics

- **Points** = sum of `d` over all days.
- **Streak** = consecutive full days (`d === t`, `t > 0`), counted up to the most
  recent graded day; paused days do not break or extend it. **Best** = max ever.
- A missed day shows red forever but only resets the streak, never points or
  history (avoids the what-the-hell effect; misses stay visible as red cells).

## Implementation

- **Approach:** vanilla JS + DOM cells. One self-contained file
  `days/index.html` (inline CSS/JS, no dependencies, no build step). 365 divs
  are trivial to render; DOM gives tooltips for free.
- **Fetch pattern:** copied from the tower: fetch endpoint → `localStorage`
  cache (`days-state`) → on failure fall back to cache with `[offline]` tag →
  else empty state.
- **Demo mode:** `?demo=N` renders N synthetic days (seeded RNG, mulberry32)
  with `t` growing 3→4→5 to exercise the volume rendering.
- **Error handling:** malformed day entries render as paused; the grid never
  crashes on bad data.
- **Testing:** `computeStats(days)` is a pure function with an assert-based
  self-check runnable via node (streak across pauses, points sum, best streak,
  empty input).

## File changes

### blog repo

| Change | Path |
| ------ | ---- |
| add    | `days/index.html` (page), small pure-JS stats + self-check |
| delete | `tower/index.html`, `assets/js/tower/` (main.js, props.js, replay.js) |
| edit   | `_config.yml`: defaults scope `path: "tower"` → `"days"` (keeps page out of sitemap, keeps OG image values) |

URL moves from `/tower/` to `/days/`. No redirect (page is noindex/private).

### modal-obsidian repo

The store already snapshots each day's goals at day start (`ensure_day`), so
per-day `{d, t}` and frozen grading come for free: `t = len(rec["goals"])`,
`d = sum(rec["goals"].values())`.

| Change | What |
| ------ | ---- |
| rename | endpoint function `tower_state` → `days_state` (this changes the URL) |
| edit   | `src/tower.py public_state()`: new wire format — `days` array of `{d, t}` / `null` (paused), `points` = Σd, `streak`/`best` = consecutive perfect days (`d == t`, `t > 0`; paused days skip, misses reset). Today (pending) is included with its live `d/t`. |
| edit   | `src/telegram/tower_commands.py`: `GOALS_NOTE = "Tower/Goals.md"` → `"Days/Goals.md"` (folder already renamed in the vault); `/tower` command + label → `/days` |
| keep   | internal names (`src/tower.py`, `TowerStore`, `/data/tower.json`, `tower_finalize` cron) — not user-visible; rename later if it grates |

Deploy + verify: `modal deploy modal_app_personal.py`, curl the new URL, check
old day statuses still finalize identically (existing tests in
`tests/test_tower.py` extended for the new wire format).

## Out of scope

- Multiple habit streams, money stakes, social features.
- Vault-side changes beyond the already-done Tower → Days folder rename.
