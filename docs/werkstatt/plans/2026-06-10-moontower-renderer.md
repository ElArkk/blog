# Moontower Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use werkstatt:subagent-driven-development (recommended) or werkstatt:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unlinked page at `/blog/tower/` that fetches Moontower state from the Modal endpoint and renders a growing cyberpunk tower in PS1-haze retro 3D.

**Architecture:** Three ES modules under `assets/js/tower/`: `replay.js` (pure state replay + seeded RNG, node-testable), `props.js` (hand-built low-poly prop library with date-gating), `main.js` (Three.js scene, PS1 pipeline, ambient animation, state fetch). A raw `tower/index.html` static file (no front matter → Jekyll copies it verbatim, jekyll-sitemap ignores it). Spec: `~/git/modal-obsidian/docs/werkstatt/specs/2026-06-10-moontower-design.md`.

**Tech Stack:** Three.js 0.160 via CDN importmap, vanilla ES modules, `node --test` for pure logic, Jekyll (existing site, no build changes).

**Working directory:** `~/git/blog`, branch `tower`, branched from the default branch **`gh-pages`** (pushing `gh-pages` publishes the site — merge only after final verification).

**Visual verification:** every visual task ends with a screenshot check. Serve with `bundle exec jekyll serve` → `http://127.0.0.1:4000/blog/tower/?demo=120`. Take screenshots with the chrome-devtools MCP tools if available, else:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --screenshot=/tmp/tower.png --window-size=1280,800 --virtual-time-budget=8000 \
  "http://127.0.0.1:4000/blog/tower/?demo=120"
```

---

## File Structure

- Create: `assets/js/tower/replay.js` — `mulberry32`, `replay`, `demoResults`, `dateOfDay`. No Three.js imports.
- Create: `assets/js/tower/props.js` — `PROPS` list + `propsAvailableOn`. Receives `THREE` as a parameter (node-testable metadata).
- Create: `assets/js/tower/main.js` — scene, PS1 pipeline, decoration, ambient animation, state fetch, HUD.
- Create: `tower/index.html` — raw static page, noindex.
- Create: `test/tower/replay.test.mjs`, `test/tower/props.test.mjs`
- Modify: `_config.yml` (exclude `test/`, `docs/`), `package.json` (add `"type": "module"`)

---

### Task 1: Branch, config, and replay module (TDD)

**Files:**
- Modify: `_config.yml`, `package.json`
- Create: `assets/js/tower/replay.js`, `test/tower/replay.test.mjs`

- [ ] **Step 1: Create the branch and exclude non-site directories**

```bash
git checkout -b tower
```

In `_config.yml`, append to the existing `exclude:` list (after `- README.md`):

```yaml
  - docs/
  - test/
```

In `package.json`, add a top-level `"type": "module",` line directly under `"main": "index.js",` (so `node --test` treats `.js` imports as ES modules).

- [ ] **Step 2: Write the failing tests**

Create `test/tower/replay.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mulberry32, replay, demoResults, dateOfDay } from "../../assets/js/tower/replay.js";

test("mulberry32 is deterministic", () => {
  const a = mulberry32(127);
  const b = mulberry32(127);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test("replay pushes on P and pops+scars on M", () => {
  // P P P M P -> days 0,1 survive; day 3's miss pops day 2 and scars day 1
  const r = replay("PPPMP");
  assert.equal(r.height, 3);
  assert.equal(r.rubble, 0);
  assert.deepEqual(r.levels.map((l) => l.day), [0, 1, 4]);
  assert.deepEqual(r.levels[1].scars, [3]);
  assert.deepEqual(r.levels[0].scars, []);
});

test("replay misses at height zero become rubble", () => {
  const r = replay("MMP");
  assert.equal(r.height, 1);
  assert.equal(r.rubble, 2);
});

test("replay popping the only level scars nothing", () => {
  const r = replay("PM");
  assert.equal(r.height, 0);
  assert.equal(r.rubble, 0);
  assert.deepEqual(r.levels, []);
});

test("replay ignores Z and pending", () => {
  const r = replay("PZ-P");
  assert.equal(r.height, 2);
});

test("demoResults is deterministic and only P/M/Z", () => {
  assert.equal(demoResults(50, 7), demoResults(50, 7));
  assert.match(demoResults(200, 1), /^[PMZ]+$/);
});

test("dateOfDay offsets ISO dates", () => {
  assert.equal(dateOfDay("2026-06-15", 0), "2026-06-15");
  assert.equal(dateOfDay("2026-06-15", 20), "2026-07-05");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/tower/`
Expected: FAIL — cannot find module `assets/js/tower/replay.js`

- [ ] **Step 4: Write the implementation**

Create `assets/js/tower/replay.js`:

```js
// Pure Moontower state replay. No Three.js imports — node-testable.

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Replays the day string like a stack: P pushes a level carrying its day
// index, M pops the top (the level below gets a scar entry), a miss with
// nothing built adds rubble. Z (paused) and - (pending) are no-ops.
export function replay(results) {
  const levels = [];
  let rubble = 0;
  for (let day = 0; day < results.length; day++) {
    const ch = results[day];
    if (ch === "P") {
      levels.push({ day, scars: [] });
    } else if (ch === "M") {
      if (levels.length === 0) rubble++;
      else {
        levels.pop();
        if (levels.length > 0) levels[levels.length - 1].scars.push(day);
      }
    }
  }
  return { levels, rubble, height: levels.length };
}

// Deterministic synthetic history for ?demo=N development mode.
export function demoResults(n, seed = 1) {
  const rand = mulberry32(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const r = rand();
    out += r < 0.72 ? "P" : r < 0.92 ? "M" : "Z";
  }
  return out;
}

export function dateOfDay(startIso, dayIndex) {
  const d = new Date(startIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/tower/`
Expected: 7 pass

- [ ] **Step 6: Commit**

```bash
git add _config.yml package.json assets/js/tower/replay.js test/tower/replay.test.mjs
git commit -m "feat(tower): replay module with seeded RNG; exclude test/docs from site"
```

---

### Task 2: Prop library

**Files:**
- Create: `assets/js/tower/props.js`, `test/tower/props.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/tower/props.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { PROPS, propsAvailableOn } from "../../assets/js/tower/props.js";

test("every prop has the required shape", () => {
  assert.ok(PROPS.length >= 10);
  for (const p of PROPS) {
    assert.match(p.name, /^[a-z-]+$/);
    assert.match(p.addedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["wall", "roof", "ledge"].includes(p.mount), p.name);
    assert.ok(p.weight > 0, p.name);
    assert.equal(typeof p.build, "function", p.name);
  }
});

test("prop names are unique", () => {
  assert.equal(new Set(PROPS.map((p) => p.name)).size, PROPS.length);
});

test("propsAvailableOn date-gates the library", () => {
  const fake = [
    { name: "old", addedOn: "2026-06-10" },
    { name: "new", addedOn: "2026-09-01" },
  ];
  assert.deepEqual(propsAvailableOn(fake, "2026-06-15").map((p) => p.name), ["old"]);
  assert.equal(propsAvailableOn(fake, "2026-09-01").length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tower/`
Expected: replay tests pass, props tests FAIL — cannot find module `props.js`

- [ ] **Step 3: Write the implementation**

Create `assets/js/tower/props.js`. Conventions: every `build(T, rand, ctx)` gets the `THREE` namespace as `T` (keeps this module import-free and node-testable), the level's RNG, and `ctx = { w, d }` (slab footprint). It returns a `T.Group` whose origin sits at the mount point; `main.js` positions it. Props that animate set `group.userData.tick = (t) => {}`. `addedOn` gates which levels may use a prop (spec: old floors never change when the library grows).

```js
// Hand-built low-poly prop library. Levels only draw from props whose
// addedOn date is <= the level's real date (date-gating per spec).

export const NEON = [0xff2d78, 0x00e5ff, 0x9d4dff, 0x00ff9c, 0xffb300];

export function propsAvailableOn(props, isoDate) {
  return props.filter((p) => p.addedOn <= isoDate);
}

function lambert(T, color, extra = {}) {
  return new T.MeshLambertMaterial({ color, ...extra });
}

function box(T, w, h, d, color, extra = {}) {
  return new T.Mesh(new T.BoxGeometry(w, h, d), lambert(T, color, extra));
}

function glow(T, w, h, color) {
  // Emissive-looking unlit plane; flickering is the prop's own tick.
  return new T.Mesh(
    new T.PlaneGeometry(w, h),
    new T.MeshBasicMaterial({ color, side: T.DoubleSide })
  );
}

function pickNeon(rand) {
  return NEON[Math.floor(rand() * NEON.length)];
}

function flicker(mesh, rand, offRate = 0.01) {
  let cool = 0;
  return () => {
    if (cool-- > 0) return;
    if (Math.random() < offRate) {
      mesh.visible = !mesh.visible;
      cool = mesh.visible ? 0 : 4 + Math.floor(rand() * 6);
    } else if (!mesh.visible) {
      mesh.visible = true;
    }
  };
}

export const PROPS = [
  {
    name: "neon-sign",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 3,
    build(T, rand) {
      const g = new T.Group();
      const sign = glow(T, 0.5 + rand() * 1.1, 0.4 + rand() * 0.5, pickNeon(rand));
      const backing = box(T, sign.geometry.parameters.width + 0.1, sign.geometry.parameters.height + 0.1, 0.06, 0x16161f);
      backing.position.z = -0.04;
      g.add(backing, sign);
      g.userData.tick = flicker(sign, rand);
      return g;
    },
  },
  {
    name: "holo-billboard",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 2,
    build(T, rand) {
      const g = new T.Group();
      const c = pickNeon(rand);
      const panel = new T.Mesh(
        new T.PlaneGeometry(1.0 + rand() * 0.8, 0.7 + rand() * 0.5),
        new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, side: T.DoubleSide })
      );
      panel.position.z = 0.35;
      const arm = box(T, 0.06, 0.06, 0.4, 0x444455);
      arm.position.z = 0.15;
      g.add(arm, panel);
      const phase = rand() * Math.PI * 2;
      g.userData.tick = (t) => {
        panel.material.opacity = 0.4 + 0.25 * Math.sin(t * 2.1 + phase);
      };
      return g;
    },
  },
  {
    name: "ac-unit",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 3,
    build(T, rand) {
      const g = new T.Group();
      const body = box(T, 0.5, 0.4, 0.3, 0x3a3a48);
      const fan = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 0.05, 8), lambert(T, 0x22222c));
      fan.rotation.x = Math.PI / 2;
      fan.position.z = 0.16;
      const streak = box(T, 0.08, 0.5, 0.01, 0x2a2226);
      streak.position.set(0.1 * (rand() - 0.5), -0.45, 0.15);
      g.add(body, fan, streak);
      return g;
    },
  },
  {
    name: "antenna",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 3,
    build(T, rand) {
      const g = new T.Group();
      const h = 0.9 + rand() * 0.9;
      const mast = box(T, 0.05, h, 0.05, 0x55556a);
      mast.position.y = h / 2;
      const cross = box(T, 0.3, 0.03, 0.03, 0x55556a);
      cross.position.y = h * 0.75;
      g.add(mast, cross);
      return g;
    },
  },
  {
    name: "dish",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 2,
    build(T, rand) {
      const g = new T.Group();
      const dish = new T.Mesh(new T.SphereGeometry(0.28, 8, 6, 0, Math.PI), lambert(T, 0x8a8a9a, { side: T.DoubleSide }));
      dish.rotation.x = -Math.PI / 3 - rand() * 0.5;
      dish.position.y = 0.3;
      const base = box(T, 0.08, 0.3, 0.08, 0x444455);
      base.position.y = 0.15;
      g.add(base, dish);
      return g;
    },
  },
  {
    name: "pipes",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 2,
    build(T, rand) {
      const g = new T.Group();
      const n = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const pipe = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 1.3, 6), lambert(T, 0x4a4a58));
        pipe.position.set(i * 0.13, 0, 0.05);
        g.add(pipe);
      }
      return g;
    },
  },
  {
    name: "laundry-line",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 2,
    build(T, rand) {
      const g = new T.Group();
      const line = box(T, 1.2, 0.015, 0.015, 0x666677);
      g.add(line);
      const colors = [0xcc6677, 0x6688cc, 0xddddcc, 0x77aa77];
      const n = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const cloth = box(T, 0.16, 0.2 + rand() * 0.12, 0.02, colors[Math.floor(rand() * colors.length)]);
        cloth.position.set(-0.45 + i * 0.28 + rand() * 0.08, -0.12, 0);
        g.add(cloth);
      }
      return g;
    },
  },
  {
    name: "vending-machine",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 2,
    build(T, rand) {
      const g = new T.Group();
      const body = box(T, 0.32, 0.6, 0.3, 0x28283a);
      body.position.y = 0.3;
      const front = glow(T, 0.2, 0.42, pickNeon(rand));
      front.position.set(0, 0.32, 0.151);
      g.add(body, front);
      g.userData.tick = flicker(front, rand, 0.004);
      return g;
    },
  },
  {
    name: "noodle-stand",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 2,
    build(T, rand) {
      const g = new T.Group();
      const counter = box(T, 0.7, 0.3, 0.35, 0x4a3a30);
      counter.position.y = 0.15;
      const roofTop = box(T, 0.8, 0.05, 0.45, 0xa33a3a);
      roofTop.position.y = 0.72;
      for (const x of [-0.34, 0.34]) {
        const leg = box(T, 0.04, 0.45, 0.04, 0x33282a);
        leg.position.set(x, 0.5, 0.14);
        g.add(leg);
      }
      const lantern = glow(T, 0.1, 0.16, 0xffb300);
      lantern.position.set(0.3, 0.55, 0.24);
      g.add(counter, roofTop, lantern);
      g.userData.tick = flicker(lantern, rand, 0.003);
      return g;
    },
  },
  {
    name: "people",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 3,
    build(T, rand) {
      const g = new T.Group();
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const person = new T.Group();
        const h = 0.22 + rand() * 0.06;
        const bodyBox = box(T, 0.07, h, 0.05, 0x101018);
        bodyBox.position.y = h / 2;
        const head = box(T, 0.05, 0.05, 0.05, 0x101018);
        head.position.y = h + 0.035;
        person.add(bodyBox, head);
        person.position.x = -0.3 + i * 0.25 + rand() * 0.1;
        person.rotation.y = rand() * Math.PI * 2;
        g.add(person);
      }
      return g;
    },
  },
  {
    name: "shrine",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 1,
    build(T, rand) {
      const g = new T.Group();
      const base = box(T, 0.3, 0.08, 0.3, 0x55333a);
      base.position.y = 0.04;
      const houseBox = box(T, 0.2, 0.18, 0.2, 0x77444e);
      houseBox.position.y = 0.17;
      const roofBox = box(T, 0.3, 0.06, 0.3, 0xaa3344);
      roofBox.position.y = 0.29;
      const lamp = glow(T, 0.05, 0.08, 0xffb300);
      lamp.position.set(0, 0.16, 0.13);
      g.add(base, houseBox, roofBox, lamp);
      g.userData.tick = flicker(lamp, rand, 0.002);
      return g;
    },
  },
  {
    name: "beacon",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 2,
    build(T, rand) {
      const g = new T.Group();
      const mast = box(T, 0.04, 0.5, 0.04, 0x55556a);
      mast.position.y = 0.25;
      const light = new T.Mesh(new T.SphereGeometry(0.06, 6, 6), new T.MeshBasicMaterial({ color: 0xff3333 }));
      light.position.y = 0.53;
      g.add(mast, light);
      const phase = rand() * Math.PI * 2;
      g.userData.tick = (t) => {
        light.visible = Math.sin(t * 2.5 + phase) > -0.2;
      };
      return g;
    },
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tower/`
Expected: 10 pass

- [ ] **Step 5: Commit**

```bash
git add assets/js/tower/props.js test/tower/props.test.mjs
git commit -m "feat(tower): 12-prop library with date-gating"
```

---

### Task 3: Page, PS1 pipeline, bare tower

**Files:**
- Create: `tower/index.html`
- Create: `assets/js/tower/main.js`

- [ ] **Step 1: Create the page**

Create `tower/index.html` (NO front matter — it must stay a static file so jekyll-sitemap ignores it):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>moontower</title>
<style>
  html, body { margin: 0; height: 100%; background: #141020; overflow: hidden; }
  #tower-canvas { width: 100vw; height: 100vh; display: block; image-rendering: pixelated; }
  #hud {
    position: fixed; top: 12px; left: 14px; color: #b8b8d0;
    font: 13px/1.5 ui-monospace, Menlo, monospace; user-select: none;
    text-shadow: 0 1px 2px #000;
  }
  #hud .offline { color: #ffb300; }
</style>
</head>
<body>
<canvas id="tower-canvas"></canvas>
<div id="hud"></div>
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }
</script>
<script type="module" src="/blog/assets/js/tower/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the scene module**

Create `assets/js/tower/main.js`:

```js
import * as THREE from "three";
import { replay, demoResults, mulberry32, dateOfDay } from "./replay.js";
import { PROPS, NEON, propsAvailableOn } from "./props.js";

// Paste the URL printed by `modal deploy` for tower_state (backend plan Task 9).
const STATE_URL = "PASTE_TOWER_STATE_URL_HERE";

const LEVEL_H = 1.6;
const LEVEL_W = 3.6;
const LEVEL_D = 3.6;
const INTERNAL_WIDTH = 320; // PS1 pipeline: render small, upscale with hard pixels
const MOON_LEVEL = 365;
const SKY = 0x141020;

const canvas = document.getElementById("tower-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 10, 34);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);

const ticks = []; // per-frame animation callbacks: fn(t)
let topY = LEVEL_H; // camera clamp ceiling, set by buildWorld

init();

async function init() {
  scene.add(new THREE.HemisphereLight(0x8888bb, 0x10101c, 0.9));
  const key = new THREE.DirectionalLight(0xaaaaff, 0.6);
  key.position.set(6, 12, 8);
  scene.add(key);

  const state = await loadState();
  buildWorld(state);
  updateHud(state);
  setupCameraControls();
  resize();
  addEventListener("resize", resize);
  requestAnimationFrame(frame);
}

// --- state ---

async function loadState() {
  const demo = new URLSearchParams(location.search).get("demo");
  if (demo) {
    const results = demoResults(parseInt(demo, 10) || 60, 1);
    const r = replay(results);
    return { start: "2026-01-01", results, height: r.height, streak: 0, best: 0, demo: true };
  }
  try {
    const res = await fetch(STATE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    localStorage.setItem("moontower-state", JSON.stringify(state));
    return state;
  } catch (err) {
    console.warn("state fetch failed, using cache", err);
    const cached = localStorage.getItem("moontower-state");
    if (cached) return { ...JSON.parse(cached), offline: true };
    return { start: null, results: "", height: 0, streak: 0, best: 0, offline: true };
  }
}

function updateHud(state) {
  const hud = document.getElementById("hud");
  const off = state.offline ? ' <span class="offline">[offline]</span>' : "";
  const demo = state.demo ? " [demo]" : "";
  hud.innerHTML =
    `HEIGHT ${state.height ?? 0} &nbsp; STREAK ${state.streak ?? 0} ` +
    `&nbsp; BEST ${state.best ?? 0} &nbsp; MOON AT ${MOON_LEVEL}${demo}${off}`;
}

// --- world ---

function buildWorld(state) {
  const { levels, rubble } = replay(state.results || "");
  topY = Math.max(levels.length * LEVEL_H, LEVEL_H) + 2;

  // ground disc
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 10, 0.5, 24),
    new THREE.MeshLambertMaterial({ color: 0x1a1726 })
  );
  ground.position.y = -0.25;
  scene.add(ground);

  for (let i = 0; i < levels.length; i++) {
    scene.add(buildLevel(levels[i], i, state.start));
  }

  addRubble(rubble);
  addMoonAndStars();
}

function buildLevel(level, index, startIso) {
  const rand = mulberry32(level.day * 2654435761 + 1);
  const group = new THREE.Group();
  group.position.y = index * LEVEL_H;

  const w = LEVEL_W * (0.85 + rand() * 0.3);
  const d = LEVEL_D * (0.85 + rand() * 0.3);
  const hue = 0.58 + rand() * 0.14;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w, LEVEL_H * 0.94, d),
    new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(hue, 0.22, 0.15 + rand() * 0.08),
    })
  );
  slab.position.y = LEVEL_H / 2;
  group.add(slab);
  group.userData.size = { w, d };
  return group;
}

function addRubble(count) {
  const rand = mulberry32(424242);
  for (let i = 0; i < Math.min(count, 40); i++) {
    const s = 0.2 + rand() * 0.5;
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * 0.6, s),
      new THREE.MeshLambertMaterial({ color: 0x232030 })
    );
    const a = rand() * Math.PI * 2;
    const r = 2.8 + rand() * 3.5;
    chunk.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
    chunk.rotation.y = rand() * Math.PI;
    scene.add(chunk);
  }
}

function addMoonAndStars() {
  const moonY = MOON_LEVEL * LEVEL_H;
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(8, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xd8d8c8, fog: false })
  );
  moon.position.set(-18, moonY, -30);
  scene.add(moon);

  const starGeo = new THREE.BufferGeometry();
  const rand = mulberry32(9001);
  const pos = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const a = rand() * Math.PI * 2;
    const y = rand() * moonY * 1.2;
    const r = 60 + rand() * 60;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9999bb, size: 0.4, fog: false })));
}

// --- camera + loop ---

let camY = 6;
let camAngle = 0;

function setupCameraControls() {
  camY = Math.max(4, topY - 2);
  addEventListener("wheel", (e) => {
    camY = Math.min(Math.max(camY + e.deltaY * 0.02, 2), topY + 6);
  }, { passive: true });

  let dragging = null;
  addEventListener("pointerdown", (e) => (dragging = e.clientY));
  addEventListener("pointerup", () => (dragging = null));
  addEventListener("pointermove", (e) => {
    if (dragging !== null) {
      camY = Math.min(Math.max(camY + (e.clientY - dragging) * 0.05, 2), topY + 6);
      dragging = e.clientY;
    }
  });
}

function resize() {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  renderer.setSize(INTERNAL_WIDTH, Math.round((INTERNAL_WIDTH * h) / w), false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let paused = false;
document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  if (!paused) requestAnimationFrame(frame);
});

function frame(ms) {
  if (paused) return;
  const t = ms / 1000;
  camAngle = t * 0.06;
  const r = 13;
  camera.position.set(Math.sin(camAngle) * r, camY + Math.sin(t * 0.4) * 0.4, Math.cos(camAngle) * r);
  camera.lookAt(0, camY, 0);
  for (const tick of ticks) tick(t);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
```

- [ ] **Step 3: Verify in the browser**

```bash
bundle exec jekyll serve
```

Open `http://127.0.0.1:4000/blog/tower/?demo=120` and screenshot (see header). Expected: pixelated foggy scene, a stack of dark slabs of varying footprints rising out of view, rubble chunks at the base, stars, HUD line top-left with `[demo]`. Scroll/drag moves the camera up and down; the view slowly orbits. Console shows no errors (favicon 404 is fine).

- [ ] **Step 4: Commit**

```bash
git add tower/index.html assets/js/tower/main.js
git commit -m "feat(tower): unlinked page with PS1 pipeline and bare tower"
```

---

### Task 4: Decoration — props, scars, milestones

**Files:**
- Modify: `assets/js/tower/main.js`

- [ ] **Step 1: Decorate levels with date-gated seeded props**

In `buildLevel`, after `group.userData.size = { w, d };` and before `return group;`, add:

```js
  decorate(group, level, rand, startIso);
```

Add these functions after `buildLevel`:

```js
function decorate(group, level, rand, startIso) {
  const { w, d } = group.userData.size;
  const levelDate = startIso ? dateOfDay(startIso, level.day) : "2026-06-10";
  const available = propsAvailableOn(PROPS, levelDate);
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  const count = 2 + Math.floor(rand() * 4); // 2-5 props per spec

  for (let i = 0; i < count; i++) {
    let roll = rand() * totalWeight;
    const prop = available.find((p) => (roll -= p.weight) <= 0) ?? available[0];
    const obj = prop.build(THREE, rand, { w, d });
    placeProp(obj, prop.mount, w, d, rand);
    group.add(obj);
    if (obj.userData.tick) ticks.push(obj.userData.tick);
  }

  for (const missDay of level.scars) addScar(group, w, d, missDay);
}

function placeProp(obj, mount, w, d, rand) {
  const side = Math.floor(rand() * 4); // 0 +z, 1 -z, 2 +x, 3 -x
  const along = (rand() - 0.5) * (side < 2 ? w - 1 : d - 1);
  if (mount === "roof") {
    obj.position.set((rand() - 0.5) * (w - 0.6), LEVEL_H * 0.94, (rand() - 0.5) * (d - 0.6));
    return;
  }
  const y = mount === "wall" ? LEVEL_H * (0.35 + rand() * 0.4) : LEVEL_H * 0.94;
  // ledge props sit on the roof edge, wall props hang on the face
  if (side === 0) { obj.position.set(along, y, d / 2 + 0.03); }
  else if (side === 1) { obj.position.set(along, y, -d / 2 - 0.03); obj.rotation.y = Math.PI; }
  else if (side === 2) { obj.position.set(w / 2 + 0.03, y, along); obj.rotation.y = Math.PI / 2; }
  else { obj.position.set(-w / 2 - 0.03, y, along); obj.rotation.y = -Math.PI / 2; }
  if (mount === "ledge") {
    // pull ledge props back onto the roof surface
    obj.position.multiplyScalar(0.82);
    obj.position.y = LEVEL_H * 0.94;
    obj.rotation.y += Math.PI; // face outward
  }
}

function addScar(group, w, d, missDay) {
  const rand = mulberry32(missDay * 7919 + 13);
  // scorch patches on the roof edge + one dangling rebar
  for (let i = 0; i < 3; i++) {
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 + rand() * 0.6, 0.06, 0.3 + rand() * 0.6),
      new THREE.MeshLambertMaterial({ color: 0x0c0a10 })
    );
    patch.position.set((rand() - 0.5) * (w - 0.5), LEVEL_H * 0.94 + 0.03, (rand() - 0.5) * (d - 0.5));
    group.add(patch);
  }
  const rebar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4),
    new THREE.MeshLambertMaterial({ color: 0x3a3026 })
  );
  rebar.position.set((rand() - 0.5) * w, LEVEL_H * 0.94 + 0.3, (rand() - 0.5) * d);
  rebar.rotation.z = 0.4 + rand() * 0.5;
  group.add(rebar);

  // smoke: three slow-rising translucent planes
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0x555566, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
  });
  const puffs = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), smokeMat.clone());
    puff.position.set((rand() - 0.5) * w * 0.6, LEVEL_H, (rand() - 0.5) * d * 0.6);
    group.add(puff);
    puffs.push({ puff, speed: 0.15 + rand() * 0.2, phase: rand() * 3 });
  }
  ticks.push((t) => {
    for (const { puff, speed, phase } of puffs) {
      const cycle = ((t * speed + phase) % 1.5);
      puff.position.y = LEVEL_H + cycle;
      puff.material.opacity = 0.25 * (1 - cycle / 1.5);
      puff.lookAt(camera.position);
    }
  });
}
```

- [ ] **Step 2: Add milestone landmarks**

In `buildWorld`, after the `for` loop that adds levels, add:

```js
  addMilestones(levels.length);
```

Add after `addRubble`:

```js
function addMilestones(height) {
  // landmarks at fixed altitudes so progress reads as earned (spec: every 30)
  for (let lvl = 30; lvl <= Math.max(height + 30, 60); lvl += 30) {
    const y = lvl * LEVEL_H;
    const kind = (lvl / 30 - 1) % 3;
    const rand = mulberry32(lvl * 31);
    if (kind === 0) {
      // cloud band: ring of flat translucent boxes
      for (let i = 0; i < 7; i++) {
        const cloud = new THREE.Mesh(
          new THREE.BoxGeometry(2.5 + rand() * 2, 0.25, 1.2 + rand()),
          new THREE.MeshLambertMaterial({ color: 0x3a3650, transparent: true, opacity: 0.7 })
        );
        const a = rand() * Math.PI * 2;
        const r = 6 + rand() * 4;
        cloud.position.set(Math.cos(a) * r, y + (rand() - 0.5), Math.sin(a) * r);
        scene.add(cloud);
      }
    } else if (kind === 1) {
      // weather balloon tethered beside the tower
      const balloon = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 8, 8),
        new THREE.MeshLambertMaterial({ color: 0xbb4455 })
      );
      balloon.position.set(5.5, y, 2);
      scene.add(balloon);
      ticks.push((t) => { balloon.position.y = y + Math.sin(t * 0.5 + lvl) * 0.4; });
    } else {
      // dead satellite drifting in a slow circle
      const sat = new THREE.Group();
      const bus = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.6), new THREE.MeshLambertMaterial({ color: 0x777788 }));
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.02, 0.5), new THREE.MeshLambertMaterial({ color: 0x2244aa }));
      sat.add(bus, panel);
      scene.add(sat);
      ticks.push((t) => {
        const a = t * 0.1 + lvl;
        sat.position.set(Math.cos(a) * 9, y, Math.sin(a) * 9);
        sat.rotation.y = a;
      });
    }
  }
}
```

- [ ] **Step 3: Verify in the browser**

Reload `http://127.0.0.1:4000/blog/tower/?demo=120` and screenshot. Expected: levels now carry neon signs (some flickering), AC units, antennas, laundry, tiny people on roof edges; a few levels show dark scorch patches with rising smoke; a cloud band around level 30 and a balloon near 60. Scroll along the full tower — no prop floats detached from its level (placement bug if so). `node --test test/tower/` still passes.

- [ ] **Step 4: Commit**

```bash
git add assets/js/tower/main.js
git commit -m "feat(tower): seeded prop decoration, collapse scars, milestone landmarks"
```

---

### Task 5: Ambient life — drones, elevator, rain

**Files:**
- Modify: `assets/js/tower/main.js`

- [ ] **Step 1: Add the ambient layer**

In `buildWorld`, after `addMilestones(levels.length);`, add:

```js
  addAmbient(levels.length);
```

Add after `addMilestones`:

```js
function addAmbient(height) {
  const towerTop = Math.max(height, 3) * LEVEL_H;

  // drones: lit boxes ferrying between random waypoints around the tower
  const rand = mulberry32(777);
  for (let i = 0; i < 3; i++) {
    const drone = new THREE.Group();
    drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.16), new THREE.MeshLambertMaterial({ color: 0x333344 })));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), new THREE.MeshBasicMaterial({ color: NEON[i % NEON.length] }));
    lamp.position.y = -0.05;
    drone.add(lamp);
    scene.add(drone);

    let from = wayPoint(rand, towerTop);
    let to = wayPoint(rand, towerTop);
    let leg = rand(); // 0..1 progress
    const speed = 0.04 + rand() * 0.04;
    ticks.push((t) => {
      leg += speed * 0.016;
      if (leg >= 1) { from = to; to = wayPoint(rand, towerTop); leg = 0; }
      drone.position.lerpVectors(from, to, leg);
      drone.position.y += Math.sin(t * 3 + i) * 0.05;
      lamp.visible = Math.sin(t * 4 + i * 2) > -0.5;
    });
  }

  // elevator light crawling up the tower face
  const elevator = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.05), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
  scene.add(elevator);
  ticks.push((t) => {
    const cycle = (t * 0.05) % 2;
    const y = (cycle < 1 ? cycle : 2 - cycle) * towerTop;
    elevator.position.set(LEVEL_W / 2 + 0.15, y, 0);
  });

  // rain: line segments falling in a column around the camera
  const RAIN = 220;
  const rainGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(RAIN * 6);
  const seeds = [];
  for (let i = 0; i < RAIN; i++) {
    seeds.push({ x: (rand() - 0.5) * 24, z: (rand() - 0.5) * 24, off: rand() * 30, sp: 9 + rand() * 5 });
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: 0x445066, transparent: true, opacity: 0.5 })
  );
  scene.add(rain);
  ticks.push((t) => {
    for (let i = 0; i < RAIN; i++) {
      const s = seeds[i];
      const y = camY + 14 - ((t * s.sp + s.off) % 28);
      rp[i * 6] = s.x; rp[i * 6 + 1] = y; rp[i * 6 + 2] = s.z;
      rp[i * 6 + 3] = s.x; rp[i * 6 + 4] = y - 0.5; rp[i * 6 + 5] = s.z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  });
}

function wayPoint(rand, towerTop) {
  const a = rand() * Math.PI * 2;
  const r = 4 + rand() * 5;
  return new THREE.Vector3(Math.cos(a) * r, 1 + rand() * towerTop, Math.sin(a) * r);
}
```

- [ ] **Step 2: Verify in the browser**

Reload `http://127.0.0.1:4000/blog/tower/?demo=120` and screenshot twice a few seconds apart. Expected: drones with blinking lights moving between positions (different between the screenshots), a cyan elevator dot at a different height, faint rain streaks, neon flicker state differing. Switch to another tab for 5 s and back — the scene resumes without a frame-time jump (visibility pause works).

- [ ] **Step 3: Commit**

```bash
git add assets/js/tower/main.js
git commit -m "feat(tower): ambient drones, elevator, rain"
```

---

### Task 6: Live state and launch

**Files:**
- Modify: `assets/js/tower/main.js`

- [ ] **Step 1: Point at the real endpoint**

Replace the `STATE_URL` placeholder with the `tower_state` URL recorded in backend plan Task 9 Step 2. (If the backend isn't deployed yet, do that first — the backend plan is independent and must land before this step.)

- [ ] **Step 2: Verify live + offline modes**

With jekyll serving, open `http://127.0.0.1:4000/blog/tower/` (no `?demo`):

1. HUD shows the real height/streak (probably tiny — that's correct), no `[demo]` tag.
2. DevTools → Network → the `tower_state` request is `200` with the CORS header (during local dev the request is cross-origin from `127.0.0.1`, which the `Access-Control-Allow-Origin: https://elarkk.github.io` header blocks — if the fetch fails locally with a CORS error but `curl` works, that is *expected*; the cache/offline path should kick in. The real check happens on the published page).
3. Simulate offline: DevTools → Network → Offline → reload → tower renders from cache with `[offline]` tag.

- [ ] **Step 3: Run all tests, merge, publish**

```bash
node --test test/tower/
git checkout gh-pages && git merge tower
git push origin gh-pages
```

**Confirm with Arkadij before pushing** — the push publishes the page. After GitHub Pages builds (~2 min), verify `https://elarkk.github.io/blog/tower/` renders the live tower with no CORS error in the console, and that the page is absent from `https://elarkk.github.io/blog/sitemap.xml`.

- [ ] **Step 4: Done check against spec**

Walk the spec's Renderer + Privacy sections once and confirm: replay rules (P/M/Z/-), date-gated props, scars + rubble, milestones, moon at 365, PS1 pipeline, ambient set, visibility pause, offline cache, noindex, no goal names anywhere in page source.

---

## Self-Review Notes

- Spec coverage: replay/stack semantics (T1), prop library + date-gating (T2), PS1 pipeline + page + camera + stars/moon/rubble (T3), decoration + scars + milestones (T4), ambient animation (T5), live fetch/cache/offline + publish checks (T6). Growth ceremonies intentionally absent (out of scope per spec).
- `dateOfDay`/`startIso` consistency: `decorate()` falls back to `"2026-06-10"` when `start` is null (fresh game) — all v1 props carry that `addedOn`, so the gate never empties.
- Local CORS failure on `127.0.0.1` is expected and routes through the offline cache path; documented in T6 so it isn't "fixed" by loosening the allowed origin.
