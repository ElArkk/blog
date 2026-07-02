# Days Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use werkstatt:subagent-driven-development (recommended) or werkstatt:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3D tower motivation game with a neon segmented habit heatmap at `/days/`, backed by a new per-day `{d, t}` wire format from the Modal endpoint.

**Architecture:** Two repos. `~/git/modal-obsidian` (Python/Modal): `src/tower.py` gains `day_counts()` + `stats()` and a new `public_state()` wire format; the deployed endpoint function is renamed `tower_state` → `days_state` (Modal derives the URL from the function name); the Telegram bot's goals note moves to `Days/Goals.md`. `~/git/blog` (Jekyll, gh-pages): new self-contained `days/index.html` + pure `days/stats.js`, tower page/assets/tests deleted. Spec: `docs/werkstatt/specs/2026-07-02-days-heatmap-design.md`.

**Tech Stack:** Python 3 + pytest (run via `uv run pytest`) on the backend; vanilla ES modules + `node --test` on the frontend. No new dependencies anywhere.

**Order matters:** Part A (backend) ships first so the new URL exists; Part B (blog) follows. Parts commit to their own repos.

---

## Part A — modal-obsidian (`/Users/arkadij/git/modal-obsidian`)

Baseline: `uv run pytest tests/test_tower.py -q` → 31 passed.

### Task 1: New wire format in `src/tower.py`

The store already freezes each day's goal snapshot at day start (`ensure_day`), so `{d, t}` falls out of `rec["goals"]`. `replay()` and `results_string()` (and `_STATUS_CHAR`) are used only by `public_state` and tests — they get deleted, not kept.

**Files:**
- Modify: `src/tower.py` (delete `_STATUS_CHAR` line 25, `results_string` lines 170-185, `replay` lines 188-202; rewrite `public_state` lines 205-215; add `day_counts`, `stats`)
- Modify: `tests/test_tower.py` (delete `test_results_string_with_pending_today`, `test_results_string_shows_z_for_paused_today`, `test_replay_height_streak_best_rubble` and any other `replay`/`results_string` tests; update `test_public_state_shape`; add new tests; fix the imports at the top to drop `replay`/`results_string` and add `day_counts`/`stats`)

- [ ] **Step 1: Write the failing tests**

In `tests/test_tower.py`, replace the deleted tests with (uses the existing `_three_days_state` fixture: day 15 perfect 2/2, day 16 partial 1/2, day 17 unrecorded):

```python
def test_day_counts_from_frozen_snapshots() -> None:
    state = _three_days_state()
    now = dt("2026-06-18 11:00")
    finalize_due(state, now)
    # day 18 is today: pending, no record yet -> live 0/0
    assert day_counts(state, now) == [
        {"d": 2, "t": 2},
        {"d": 1, "t": 2},
        {"d": 0, "t": 0},
        {"d": 0, "t": 0},
    ]


def test_day_counts_paused_day_is_none() -> None:
    state = _three_days_state()
    set_pause(state, dt("2026-06-16 11:00"), days=1)  # pauses the 17th
    now = dt("2026-06-18 11:00")
    finalize_due(state, now)
    assert day_counts(state, now)[2] is None


def test_day_counts_empty_state() -> None:
    assert day_counts(default_state(), dt("2026-06-18 11:00")) == []


def test_stats_points_sum_all_completed_objectives() -> None:
    days = [{"d": 3, "t": 3}, {"d": 1, "t": 4}, None, {"d": 0, "t": 4}]
    assert stats(days)["points"] == 4


def test_stats_streak_perfect_days_only_miss_resets() -> None:
    days = [{"d": 3, "t": 3}, {"d": 4, "t": 4}, {"d": 0, "t": 4},
            {"d": 4, "t": 4}, {"d": 4, "t": 4}]
    s = stats(days)
    assert s["streak"] == 2
    assert s["best"] == 2


def test_stats_paused_days_do_not_break_streak() -> None:
    days = [{"d": 3, "t": 3}, None, {"d": 4, "t": 4}]
    assert stats(days)["streak"] == 2


def test_stats_closed_partial_resets_open_today_does_not() -> None:
    # middle partial is a closed day -> resets
    assert stats([{"d": 3, "t": 3}, {"d": 1, "t": 3}, {"d": 3, "t": 3}])["streak"] == 1
    # trailing partial is today, still open -> streak survives
    assert stats([{"d": 3, "t": 3}, {"d": 3, "t": 3}, {"d": 1, "t": 3}])["streak"] == 2


def test_stats_empty_goal_day_is_not_perfect() -> None:
    assert stats([{"d": 0, "t": 0}, {"d": 0, "t": 0}])["streak"] == 0


def test_public_state_shape() -> None:
    state = _three_days_state()
    now = dt("2026-06-18 11:00")
    finalize_due(state, now)
    assert public_state(state, now) == {
        "start": "2026-06-15",
        "days": [{"d": 2, "t": 2}, {"d": 1, "t": 2}, {"d": 0, "t": 0}, {"d": 0, "t": 0}],
        "streak": 0,
        "best": 1,
        "points": 3,
    }
```

Update the import block at the top of the file: remove `replay` and `results_string`, add `day_counts` and `stats`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/arkadij/git/modal-obsidian && uv run pytest tests/test_tower.py -q`
Expected: ImportError (`day_counts` not defined).

- [ ] **Step 3: Implement in `src/tower.py`**

Delete `_STATUS_CHAR` (line 25), `results_string()` (lines 170-185), `replay()` (lines 188-202). Replace `public_state()` with:

```python
def day_counts(state: dict, now: datetime) -> list[dict | None]:
    """Per-day {d, t} from each day's frozen goal snapshot; None = paused.

    t was captured when the day started, so adding objectives later never
    re-grades history. The trailing entry is today (still open) with live
    counts.
    """
    if state["start_date"] is None:
        return []
    out: list[dict | None] = []
    d = date.fromisoformat(state["start_date"])
    today = game_date(now)
    while d <= today:
        rec = state["days"].get(d.isoformat())
        status = rec["status"] if rec else None
        if status == PAUSED or (status in (None, PENDING) and is_paused(state, d)):
            out.append(None)
        else:
            goals = rec["goals"] if rec else {}
            out.append({"d": sum(goals.values()), "t": len(goals)})
        d += timedelta(days=1)
    return out


def stats(days: list[dict | None]) -> dict:
    """points = sum of completed objectives (4/4 banks more than 3/3).

    streak/best count consecutive perfect days (d == t, t > 0). Paused days
    are skipped. The trailing day (today, still open) extends the streak when
    perfect but never breaks it.
    """
    points = streak = best = 0
    for i, day in enumerate(days):
        if day is None:
            continue
        points += day["d"]
        if day["t"] > 0 and day["d"] == day["t"]:
            streak += 1
            best = max(best, streak)
        elif i < len(days) - 1:
            streak = 0
    return {"points": points, "streak": streak, "best": best}


def public_state(state: dict, now: datetime) -> dict:
    """The abstract wire format. No goal names, no per-goal results."""
    days = day_counts(state, now)
    return {"start": state["start_date"], "days": days, **stats(days)}
```

Also update the module docstring's first line: `"""Days habit tracking: state store, day logic, public serialization.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_tower.py -q`
Expected: all pass (31 - 3 deleted + 8 new = 36 passed).

- [ ] **Step 5: Commit**

```bash
cd /Users/arkadij/git/modal-obsidian
git add src/tower.py tests/test_tower.py
git commit -m "days: per-day {d,t} wire format with points and perfect-day streak"
```

### Task 2: Rename endpoint `tower_state` → `days_state`

Modal derives the public URL from the function name; the rename is what moves the URL to `https://elarkk--obsidian-personal-days-state.modal.run`.

**Files:**
- Modify: `modal_app_personal.py` (function def ~line 266, its docstring, comment ~line 152, `tower_finalize` docstring ~line 239)

- [ ] **Step 1: Rename the function and update comments**

In `modal_app_personal.py`:

```python
@modal.fastapi_endpoint(method="GET", docs=False)
def days_state():
    """Public Days state: per-day {d, t} counts + stats. No goal names."""
```

(only the `def` line and docstring change; the decorator stack, body, CORS header `https://elarkk.github.io`, and `Cache-Control: no-store` stay as they are).

Update the comment at ~line 152: `tower_state endpoint` → `days_state endpoint`.
Update `tower_finalize`'s docstring at ~line 239: `/tower and /tower-state` → `/days and /days-state`.

- [ ] **Step 2: Sanity-check nothing else references the old name**

Run: `grep -rn "tower_state" --include="*.py" .`
Expected: no hits.

- [ ] **Step 3: Commit**

```bash
git add modal_app_personal.py
git commit -m "days: rename tower_state endpoint to days_state (new public URL)"
```

### Task 3: Telegram bot — goals note path and command name

The vault folder was already renamed Tower → Days, so `GOALS_NOTE` is currently broken. Internal names (mixin, callback data `tower:`, `/data/tower.json`, `tower_finalize`) stay — not user-visible.

**Files:**
- Modify: `src/telegram/tower_commands.py` (lines 35, 40, 69)

- [ ] **Step 1: Update path and command**

```python
GOALS_NOTE = "Days/Goals.md"
```

In `TOWER_COMMANDS`:

```python
    BotCommand("days", "Record today's goals (Days)"),
```

In `register_tower_handlers`:

```python
        application.add_handler(CommandHandler("days", self.tower))
```

- [ ] **Step 2: Run the test suite**

Run: `uv run pytest -q`
Expected: all pass (keyboard test asserts callback data `tower:...`, which is unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/telegram/tower_commands.py
git commit -m "days: goals note at Days/Goals.md, /days telegram command"
```

### Task 4: Deploy and verify the endpoint

- [ ] **Step 1: Deploy**

Run: `modal deploy modal_app_personal.py`
Expected: deploy succeeds; output lists `days_state` with URL `https://elarkk--obsidian-personal-days-state.modal.run`.

- [ ] **Step 2: Verify the wire format**

Run: `curl -s https://elarkk--obsidian-personal-days-state.modal.run | python3 -m json.tool`
Expected: JSON with keys `start`, `days` (array of `{"d": n, "t": n}` / `null`), `streak`, `best`, `points`. Existing history days map to their old statuses (perfect days show `d == t`, misses `d < t` or `0/0`, paused `null`).

- [ ] **Step 3: Verify the old URL is gone**

Run: `curl -s -o /dev/null -w "%{http_code}" https://elarkk--obsidian-personal-tower-state.modal.run`
Expected: 404.

---

## Part B — blog (`/Users/arkadij/git/blog`, branch gh-pages)

### Task 5: Pure stats module + node tests

Mirrors the backend `stats()` exactly (same trailing-open-day rule) and provides demo data. Follows the repo's existing `test/tower/*.test.mjs` node-test idiom.

**Files:**
- Create: `days/stats.js`
- Create: `test/days/stats.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/days/stats.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { computeStats, demoDays, mulberry32 } from "../../days/stats.js";

test("points sum all completed objectives", () => {
  const days = [{ d: 3, t: 3 }, { d: 1, t: 4 }, null, { d: 0, t: 4 }];
  assert.equal(computeStats(days).points, 4);
});

test("streak counts consecutive perfect days, miss resets", () => {
  const days = [{ d: 3, t: 3 }, { d: 4, t: 4 }, { d: 0, t: 4 },
                { d: 4, t: 4 }, { d: 4, t: 4 }];
  const s = computeStats(days);
  assert.equal(s.streak, 2);
  assert.equal(s.best, 2);
});

test("paused days do not break the streak", () => {
  assert.equal(computeStats([{ d: 3, t: 3 }, null, { d: 4, t: 4 }]).streak, 2);
});

test("closed partial resets, trailing open today does not", () => {
  assert.equal(computeStats([{ d: 3, t: 3 }, { d: 1, t: 3 }, { d: 3, t: 3 }]).streak, 1);
  assert.equal(computeStats([{ d: 3, t: 3 }, { d: 3, t: 3 }, { d: 1, t: 3 }]).streak, 2);
});

test("empty-goal day (0/0) is not perfect", () => {
  assert.equal(computeStats([{ d: 0, t: 0 }, { d: 0, t: 0 }]).streak, 0);
});

test("empty input", () => {
  assert.deepEqual(computeStats([]), { points: 0, streak: 0, best: 0 });
});

test("mulberry32 is deterministic", () => {
  const a = mulberry32(7), b = mulberry32(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("demoDays shape: t grows, d never exceeds t", () => {
  const days = demoDays(120, 1);
  assert.equal(days.length, 120);
  for (const day of days) {
    if (day === null) continue;
    assert.ok(day.t >= 3 && day.t <= 5);
    assert.ok(day.d >= 0 && day.d <= day.t);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/arkadij/git/blog && node --test test/days/`
Expected: FAIL — cannot find module `days/stats.js`.

- [ ] **Step 3: Implement `days/stats.js`**

```js
// Pure Days stats + demo data. No DOM — node-testable.
// Mirrors stats() in modal-obsidian/src/tower.py: keep the two in sync.

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// points = sum of completed objectives (4/4 banks more than 3/3).
// streak/best count consecutive perfect days (d === t, t > 0); paused (null)
// days skip; the trailing day (today, still open) extends the streak when
// perfect but never breaks it.
export function computeStats(days) {
  let points = 0, streak = 0, best = 0;
  days.forEach((day, i) => {
    if (day == null) return;
    points += day.d;
    if (day.t > 0 && day.d === day.t) {
      streak += 1;
      best = Math.max(best, streak);
    } else if (i < days.length - 1) {
      streak = 0;
    }
  });
  return { points, streak, best };
}

// Deterministic synthetic history for ?demo=N development mode.
// t grows 3 -> 4 -> 5 across the span to exercise the volume rendering.
export function demoDays(n, seed = 1) {
  const rand = mulberry32(seed);
  const days = [];
  for (let i = 0; i < n; i++) {
    const t = i < n / 3 ? 3 : i < (2 * n) / 3 ? 4 : 5;
    const r = rand();
    if (r < 0.6) days.push({ d: t, t });
    else if (r < 0.78) days.push({ d: Math.max(1, Math.floor(rand() * t)), t });
    else if (r < 0.88) days.push({ d: 0, t });
    else days.push(null);
  }
  return days;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/days/`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add days/stats.js test/days/stats.test.mjs
git commit -m "days: pure stats module (points, perfect-day streak) with node tests"
```

### Task 6: The page — `days/index.html`

Self-contained page: neon segmented year grid, HUD stats line, tower's fetch/cache/offline pattern, `?demo=N`. Server-sent `streak`/`best`/`points` win over client-computed ones when present.

**Files:**
- Create: `days/index.html`

- [ ] **Step 1: Create the page**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>days</title>
<style>
  html, body { margin: 0; min-height: 100%; background: #0d0a18; }
  body {
    display: flex; flex-direction: column; align-items: center;
    padding: 48px 16px; box-sizing: border-box;
  }
  #hud {
    color: #8f8fb0; font: 13px/1.6 ui-monospace, Menlo, monospace;
    margin-bottom: 24px; text-align: center; user-select: none;
  }
  #hud b { color: #2de0a5; text-shadow: 0 0 8px #2de0a5aa; font-weight: 600; }
  #hud .partial { color: #9adfff; }
  #hud .missed { color: #ff3860; text-shadow: 0 0 8px #ff386088; }
  #hud .offline { color: #ffb300; }
  #grid-wrap { max-width: 100%; overflow-x: auto; padding: 4px; }
  #grid {
    display: grid; grid-template-rows: repeat(7, 15px);
    grid-auto-flow: column; grid-auto-columns: 15px; gap: 4px;
  }
  .cell { border-radius: 3px; background: #1c1930; position: relative; }
  .cell .segs {
    position: absolute; inset: 2px;
    display: flex; flex-direction: column-reverse; gap: 1px;
  }
  .cell .segs div { flex: 1; border-radius: 1px; background: #141126; }
  .cell .segs .on { background: #2de0a5; }
  .cell.full .segs .on { background: #6ff5ff; }
  .cell.full { box-shadow: 0 0 7px rgba(111, 245, 255, 0.6); }
  .cell.miss {
    background: #3d1220; box-shadow: inset 0 0 3px #ff3860aa;
    border: 1px solid #ff386055; box-sizing: border-box;
  }
  .cell.pause { background: #16132a; }
  .cell.today { outline: 1px solid #4a4670; }
  .cell.future { background: rgba(20, 17, 34, 0.33); }
  .cell.blank { background: transparent; }
</style>
</head>
<body>
<div id="hud">loading…</div>
<div id="grid-wrap"><div id="grid"></div></div>
<script type="module">
import { computeStats, demoDays } from "./stats.js";

const STATE_URL = "https://elarkk--obsidian-personal-days-state.modal.run";
const DAY_MS = 86400e3;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

async function loadState() {
  const demo = new URLSearchParams(location.search).get("demo");
  if (demo) {
    const n = Math.min(parseInt(demo, 10) || 140, 2000);
    const startMs = Date.now() - (n - 1) * DAY_MS;
    return { start: iso(startMs), days: demoDays(n), demo: true };
  }
  try {
    const res = await fetch(STATE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    try {
      localStorage.setItem("days-state", JSON.stringify(state));
    } catch {
      // quota error — fresh state is still valid, just not cached
    }
    return state;
  } catch (err) {
    console.warn("state fetch failed, using cache", err);
    const cached = localStorage.getItem("days-state");
    if (cached) {
      try {
        return { ...JSON.parse(cached), offline: true };
      } catch {
        // corrupt cache — fall through to empty state
      }
    }
    return { start: null, days: [], offline: true };
  }
}

// A day entry is valid when it's {d, t} with 0 <= d <= t; anything malformed
// renders as paused rather than crashing the grid.
function counts(day) {
  const d = Number(day?.d), t = Number(day?.t);
  if (!Number.isFinite(d) || !Number.isFinite(t) || d < 0 || t < 0 || d > t) return null;
  return { d, t };
}

function cell(cls, title) {
  const el = document.createElement("div");
  el.className = "cell" + (cls ? " " + cls : "");
  if (title) el.title = title;
  return el;
}

function dayCell(day, dateStr, open) {
  if (day === null) return cell("pause", `${dateStr} — paused`);
  const c = counts(day);
  if (!c) return cell("pause", `${dateStr} — ?`);
  if (c.d === 0 && !open) return cell("miss", `${dateStr} — 0/${c.t}`);
  const full = c.t > 0 && c.d === c.t;
  const el = cell(full ? "full" : open ? "today" : "", `${dateStr} — ${c.d}/${c.t}`);
  const segs = document.createElement("div");
  segs.className = "segs";
  for (let s = 0; s < c.t; s++) {
    const seg = document.createElement("div");
    if (s < c.d) seg.className = "on";
    segs.appendChild(seg);
  }
  el.appendChild(segs);
  return el;
}

function render(state) {
  const days = Array.isArray(state.days) ? state.days : [];
  const computed = computeStats(days.map(counts));
  const points = state.points ?? computed.points;
  const streak = state.streak ?? computed.streak;
  const best = state.best ?? computed.best;

  // tallies over closed days only (today, the trailing entry, is still open)
  let full = 0, partial = 0, missed = 0;
  days.slice(0, -1).forEach((day) => {
    const c = day === null ? null : counts(day);
    if (!c) return;
    if (c.t > 0 && c.d === c.t) full += 1;
    else if (c.d > 0) partial += 1;
    else missed += 1;
  });

  const off = state.offline ? ' <span class="offline">[offline]</span>' : "";
  const demo = state.demo ? " [demo]" : "";
  document.getElementById("hud").innerHTML =
    `POINTS <b>${points}</b> · STREAK <b>${streak}</b> · BEST <b>${best}</b> · ` +
    `FULL <b>${full}</b> · <span class="partial">PARTIAL ${partial}</span> · ` +
    `<span class="missed">MISSED ${missed}</span>${demo}${off}`;

  if (!state.start || !days.length) return;
  const grid = document.getElementById("grid");
  const startMs = Date.parse(state.start + "T00:00:00Z");
  const offset = (new Date(startMs).getUTCDay() + 6) % 7; // Mon = row 0
  for (let i = 0; i < offset; i++) grid.appendChild(cell("blank"));
  days.forEach((day, i) => {
    grid.appendChild(dayCell(day, iso(startMs + i * DAY_MS), i === days.length - 1));
  });
  // faded future cells to the end of the current calendar year
  const lastMs = startMs + (days.length - 1) * DAY_MS;
  const endMs = Date.parse(`${new Date(lastMs).getUTCFullYear()}-12-31T00:00:00Z`);
  for (let ms = lastMs + DAY_MS; ms <= endMs; ms += DAY_MS) {
    grid.appendChild(cell("future", iso(ms)));
  }
}

render(await loadState());
</script>
</body>
</html>
```

- [ ] **Step 2: Verify locally with demo data**

Run: `bundle exec jekyll serve` (leave running), then open `http://localhost:4000/blog/days/?demo=140` in a browser.
Expected: HUD line with POINTS/STREAK/BEST/FULL/PARTIAL/MISSED + `[demo]`; a year grid where full days glow cyan with countable slivers (3 in the left third, 5 on the right), partial days show partly-lit teal slivers, misses are red ember cells, the last cell has a subtle outline (today), and the rest of the year fades out. Hovering a cell shows `YYYY-MM-DD — d/t`.

- [ ] **Step 3: Commit**

```bash
git add days/index.html
git commit -m "days: neon segmented habit heatmap page"
```

### Task 7: Jekyll config + tower teardown

**Files:**
- Modify: `_config.yml` (defaults scope at lines 50-51)
- Delete: `tower/index.html`, `assets/js/tower/` (main.js, props.js, replay.js), `test/tower/`

- [ ] **Step 1: Update the sitemap-exclusion scope**

In `_config.yml`, change the defaults scope path (line 51):

```yaml
  - scope:
      path: "days"
    values:
      sitemap: false
      image_width: 950
      image_height: 630
      image_alt: "ElArk's Blog"
```

- [ ] **Step 2: Delete the tower**

```bash
git rm -r tower assets/js/tower test/tower
```

- [ ] **Step 3: Check nothing else references the tower**

Run: `grep -rn "tower" --include="*.html" --include="*.yml" --include="*.md" --include="*.js" . | grep -v _site | grep -v node_modules | grep -v vendor | grep -v docs/werkstatt | grep -v .werkstatt`
Expected: no hits (spec/plan mentions under docs/werkstatt are fine).

- [ ] **Step 4: Verify the site still builds**

Run: `bundle exec jekyll build`
Expected: build succeeds; `_site/days/index.html` exists; `_site/tower/` gone; `_site/sitemap.xml` contains no `/days/` entry.

- [ ] **Step 5: Commit**

```bash
git add _config.yml
git commit -m "days: replace tower page, exclude /days/ from sitemap"
```

### Task 8: End-to-end verification against the real endpoint

- [ ] **Step 1: Node tests still green**

Run: `node --test test/days/`
Expected: 8 passed.

- [ ] **Step 2: Live page against the deployed endpoint**

With `bundle exec jekyll serve` running, open `http://localhost:4000/blog/days/` (no `?demo`).
Expected: real history renders (old perfect days = full cyan cells, misses red, paused neutral); HUD shows server stats; no console errors. If the endpoint is unreachable, the page shows `[offline]` with cached/empty state instead of crashing.

- [ ] **Step 3: Push both repos**

```bash
cd /Users/arkadij/git/blog && git push
cd /Users/arkadij/git/modal-obsidian && git push
```

Expected: blog GitHub Actions deploys gh-pages; `https://elarkk.github.io/blog/days/` serves the page (CORS on the endpoint already allows `https://elarkk.github.io`).
