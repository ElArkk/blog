import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { replay, demoResults, mulberry32, dateOfDay } from "./replay.js";
import { PROPS, NEON, propsAvailableOn } from "./props.js";

const STATE_URL = "https://elarkk--obsidian-personal-tower-state.modal.run";

const LEVEL_H = 2.4;
const LEVEL_W = 5.4;
const LEVEL_D = 5.4;
const SLAB_TOP = LEVEL_H / 2 + (LEVEL_H * 0.94) / 2; // top face of a level slab
const INTERNAL_WIDTH = 320; // PS1 pipeline: render small, upscale with hard pixels
const MOON_LEVEL = 365;
const SKY = 0x141020;
const PROP_SCALE = 1.35; // grand-scale pass: props grow with the bigger plates

const canvas = document.getElementById("tower-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 12, 48);
// far plane reaches the moon (~level 365 * LEVEL_H) so the goal is always visible
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);

const ticks = []; // per-frame animation callbacks: fn(t)
let topY = LEVEL_H; // camera clamp ceiling, set by buildWorld
let controls; // OrbitControls, created in setupControls after buildWorld

// window-light grids: one InstancedMesh per level, shared geometry/material.
// The geometry is the standard pane; size variants scale the instance matrix.
const windowMeshes = []; // { mesh, y } — registry for the ambient flicker tick
const WINDOW_GEO = new THREE.BoxGeometry(0.18, 0.26, 0.04);
const WINDOW_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff }); // tinted per instance
const WINDOW_LIT_RATE = 0.4;
const WINDOW_DARK = 0x12121c;
// pane variants an edge can pick: small, standard, or wide shopfront
// (single row near street level); pitch is the column spacing.
const PANES = [
  { w: 0.16, h: 0.22, pitch: 0.4, single: false },
  { w: 0.18, h: 0.26, pitch: 0.4, single: false },
  { w: 0.5, h: 0.34, pitch: 0.7, single: true },
];

// Per-level slab palette families: each is a (hue, saturation, lightness)
// range, all kept dim so neon and lit windows still pop. A level seeds into
// one family; juts can borrow an accent family for contrast.
const PALETTES = [
  { h: [0.58, 0.72], s: [0.18, 0.28], l: [0.12, 0.22] }, // cool blue-violet (original)
  { h: [0.45, 0.52], s: [0.18, 0.30], l: [0.12, 0.20] }, // teal
  { h: [0.03, 0.09], s: [0.22, 0.38], l: [0.12, 0.20] }, // warm rust/brown
  { h: [0.18, 0.28], s: [0.10, 0.20], l: [0.13, 0.21] }, // olive-grey
  { h: [0.86, 0.96], s: [0.12, 0.22], l: [0.13, 0.21] }, // magenta-grey
];

function familyColor(fam, rand) {
  const lerp = (a, b) => a + (b - a) * rand();
  return new THREE.Color().setHSL(
    lerp(fam.h[0], fam.h[1]),
    lerp(fam.s[0], fam.s[1]),
    lerp(fam.l[0], fam.l[1])
  );
}

function windowColor(r, bias = 0) {
  // r in [0,1): weighted toward warm amber, then pale cyan, then off-white.
  // bias > 0 leans the whole level amber, bias < 0 leans it cyan.
  const amberCut = Math.min(0.82, Math.max(0.28, 0.55 + bias));
  const cyanCut = Math.min(0.95, amberCut + 0.25);
  return r < amberCut ? 0xffb36b : r < cyanCut ? 0x9adfff : 0xfff2cc;
}

init().catch((err) => {
  console.error(err);
  document.getElementById("hud").textContent = "moontower failed to start — see console";
});

async function init() {
  scene.add(new THREE.HemisphereLight(0x8888bb, 0x10101c, 0.9));
  const key = new THREE.DirectionalLight(0xaaaaff, 0.6);
  key.position.set(6, 12, 8);
  scene.add(key);

  const state = await loadState();
  buildWorld(state);
  updateHud(state);
  setupControls();
  resize();
  addEventListener("resize", resize);
  // freeze static matrices: only objects whose tick mutates their LOCAL
  // transform carry userData.animated. Children of animated groups stay
  // frozen too — three.js still refreshes their world matrices when the
  // parent moves.
  scene.traverse((o) => {
    if (!o.userData.animated) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    }
  });
  schedule();
}

// --- state ---

async function loadState() {
  const demo = new URLSearchParams(location.search).get("demo");
  if (demo) {
    const n = Math.min(parseInt(demo, 10) || 60, 2000);
    const results = demoResults(n, 1);
    const r = replay(results);
    return { start: "2026-06-10", results, height: r.height, streak: 0, best: 0, demo: true };
  }
  try {
    const res = await fetch(STATE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    try {
      localStorage.setItem("moontower-state", JSON.stringify(state));
    } catch {
      // quota error — fresh state is still valid, just not cached
    }
    return state;
  } catch (err) {
    console.warn("state fetch failed, using cache", err);
    const cached = localStorage.getItem("moontower-state");
    if (cached) {
      try {
        return { ...JSON.parse(cached), offline: true };
      } catch {
        // corrupt cache — fall through to empty state
      }
    }
    return { start: null, results: "", height: 0, streak: 0, best: 0, offline: true };
  }
}

function updateHud(state) {
  const hud = document.getElementById("hud");
  const off = state.offline ? ' <span class="offline">[offline]</span>' : "";
  const demo = state.demo ? " [demo]" : "";
  const h = Number(state.height) || 0;
  const s = Number(state.streak) || 0;
  const b = Number(state.best) || 0;
  hud.innerHTML =
    `HEIGHT ${h} &nbsp; STREAK ${s} ` +
    `&nbsp; BEST ${b} &nbsp; MOON AT ${MOON_LEVEL}${demo}${off}`;
}

// --- world ---

function buildWorld(state) {
  const { levels, rubble } = replay(state.results || "");
  topY = Math.max(levels.length * LEVEL_H, LEVEL_H) + 3;

  // ground disc
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 0.5, 24),
    new THREE.MeshLambertMaterial({ color: 0x1a1726 })
  );
  ground.position.y = -0.25;
  scene.add(ground);

  for (let i = 0; i < levels.length; i++) {
    scene.add(buildLevel(levels[i], i, state.start));
  }
  if (windowMeshes.length) ticks.push(windowFlickerTick());
  addMilestones(levels.length);
  addAmbient(levels.length);

  addRubble(rubble);
  addMoonAndStars(levels.length);
}

function buildLevel(level, index, startIso) {
  const rand = mulberry32(level.day * 2654435761 + 1);
  const group = new THREE.Group();
  group.position.y = index * LEVEL_H;

  const famIndex = Math.floor(rand() * PALETTES.length);
  const family = PALETTES[famIndex];
  const slabMat = () => new THREE.MeshLambertMaterial({ color: familyColor(family, rand) });

  // main massing block: irregular extruded floor plan + staggered stacking offset
  const w = LEVEL_W * (0.6 + rand() * 0.7);
  const d = LEVEL_D * (0.6 + rand() * 0.7);
  const offX = (rand() - 0.5) * 1.2;
  const offZ = (rand() - 0.5) * 1.2;
  const { poly, edges } = buildOutline(w, d, offX, offZ, rand);
  const shape = new THREE.Shape();
  shape.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], poly[i][1]);
  const slab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: LEVEL_H * 0.94, bevelEnabled: false }),
    slabMat()
  );
  // shape XY lies in world XZ after this rotation; the extrusion runs straight
  // down so the slab spans y 0.072..SLAB_TOP like the old box did
  slab.rotation.x = Math.PI / 2;
  slab.position.y = SLAB_TOP;
  group.add(slab);

  // 1-3 jut boxes half-sunk into a face: extra corners and edges
  const juts = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < juts; i++) {
    const jw = 0.7 + rand() * 1.5;
    const jd = 0.7 + rand() * 1.5;
    const jh = LEVEL_H * (0.35 + rand() * 0.59);
    const side = Math.floor(rand() * 4);
    const along = (rand() - 0.5) * 0.7 * (side < 2 ? w : d);
    // ~25% of juts borrow a different palette family as an accent tint
    const jutMat =
      rand() < 0.25
        ? new THREE.MeshLambertMaterial({
            color: familyColor(
              PALETTES[(famIndex + 1 + Math.floor(rand() * (PALETTES.length - 1))) % PALETTES.length],
              rand
            ),
          })
        : slabMat();
    const jut = new THREE.Mesh(new THREE.BoxGeometry(jw, jh, jd), jutMat);
    const jx = side === 2 ? w / 2 : side === 3 ? -w / 2 : along;
    const jz = side === 0 ? d / 2 : side === 1 ? -d / 2 : along;
    jut.position.set(offX + jx, jh / 2, offZ + jz);
    group.add(jut);
  }

  // terrace: outdoor deck at roof height with railing posts (people live here)
  let terrace = null;
  if (rand() < 0.6) {
    const tw = 1.3 + rand() * 1.7;
    const td = 1.3 + rand() * 1.7;
    const side = Math.floor(rand() * 4);
    let tx = offX + (rand() - 0.5) * w * 0.4;
    let tz = offZ + (rand() - 0.5) * d * 0.4;
    if (side === 0) tz = offZ + d / 2 + td / 2 - 0.2;
    else if (side === 1) tz = offZ - d / 2 - td / 2 + 0.2;
    else if (side === 2) tx = offX + w / 2 + tw / 2 - 0.2;
    else tx = offX - w / 2 - tw / 2 + 0.2;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.08, td), slabMat());
    plate.position.set(tx, SLAB_TOP + 0.04, tz);
    group.add(plate);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x55556a });
    for (const [px, pz] of [
      [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), postMat);
      post.position.set(
        tx + (px * (tw - 0.06)) / 2,
        SLAB_TOP + 0.23,
        tz + (pz * (td - 0.06)) / 2
      );
      group.add(post);
    }
    terrace = { x: tx, z: tz, w: tw, d: td };
  }

  group.userData.size = { w, d, offX, offZ, terrace, edges, poly };
  const windowBias = (rand() - 0.5) * 0.5; // -0.25..0.25 warmth lean for the whole level
  // props go first: the window + facade passes read their footprints so no
  // pane or cladding patch ends up underneath a neon sign or awning
  const placed = decorate(group, level, rand, startIso);
  addWindows(group, edges, rand, windowBias, placed);
  addFacadeDetails(group, edges, rand, family, placed);
  return group;
}

// Shoelace area of the [x,z] outline polygon (winding-independent).
function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a) / 2;
}

// Seeded irregular floor plan: the w×d rect bitten by 0-3 corner chamfers,
// 0-2 rectangular edge notches, and an occasional L-cut (quarter bite).
// Returns the outline as CCW points [[x,z],...] (level-local, offX/offZ
// baked in) plus edge segments with outward normals — the placement
// contract every wall/ledge prop and window grid relies on. With CCW
// winding the outward normal of edge a->b is (dz, -dx)/len.
function buildOutline(w, d, offX, offZ, rand) {
  const hw = w / 2;
  const hd = d / 2;
  const C = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]; // corners, CCW from above
  const U = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // side i runs C[i] -> C[i+1]
  const L = [w, d, w, d];
  // per-corner cut: a = cutback along the incoming side, b = along the outgoing
  const cuts = [null, null, null, null];

  // occasional big L-cut: a quarter bite out of one corner
  if (rand() < 0.2) {
    const ci = Math.floor(rand() * 4);
    cuts[ci] = {
      a: (0.3 + rand() * 0.2) * L[(ci + 3) % 4],
      b: (0.3 + rand() * 0.2) * L[ci],
      kind: "L",
    };
  }

  // 0-3 chamfers on distinct corners (an L-cut corner keeps its L-cut)
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const chams = Math.floor(rand() * 4);
  for (let k = 0; k < chams; k++) {
    const ci = order[k];
    if (cuts[ci]) continue;
    const c = 0.3 + rand() * 0.6;
    cuts[ci] = { a: c, b: c, kind: "cham" };
  }

  // 0-2 rectangular notches bitten into the side faces
  const notches = [[], [], [], []];
  const nNot = Math.floor(rand() * 3);
  for (let k = 0; k < nNot; k++) {
    const si = Math.floor(rand() * 4);
    const half = (0.4 + rand() * 0.6) / 2;
    const depth = 0.3 + rand() * 0.3;
    const roll = rand();
    // reserve at least the max notch depth (0.6) from each corner so notches
    // on adjacent sides can never reach each other across the corner
    const lo = Math.max(cuts[si] ? cuts[si].b : 0, 0.6) + half + 0.08;
    const hi = L[si] - Math.max(cuts[(si + 1) % 4] ? cuts[(si + 1) % 4].a : 0, 0.6) - half - 0.08;
    if (hi <= lo) continue; // side too consumed — skip, draws stay deterministic
    const pos = lo + roll * (hi - lo);
    if (notches[si].some((n) => Math.abs(n.pos - pos) < n.half + half + 0.08)) continue;
    notches[si].push({ pos, half, depth });
  }
  for (const list of notches) list.sort((a, b) => a.pos - b.pos);

  const poly = [];
  for (let i = 0; i < 4; i++) {
    const cut = cuts[i];
    const [cx, cz] = C[i];
    const [ox, oz] = U[i]; // outgoing side direction
    const [ix, iz] = U[(i + 3) % 4]; // incoming side direction
    if (cut && cut.kind === "L") {
      poly.push([cx - ix * cut.a, cz - iz * cut.a]);
      poly.push([cx - ix * cut.a + ox * cut.b, cz - iz * cut.a + oz * cut.b]);
      poly.push([cx + ox * cut.b, cz + oz * cut.b]);
    } else if (cut) {
      poly.push([cx - ix * cut.a, cz - iz * cut.a]);
      poly.push([cx + ox * cut.b, cz + oz * cut.b]);
    } else {
      poly.push([cx, cz]);
    }
    for (const nt of notches[i]) {
      const [nx, nz] = U[(i + 1) % 4]; // inward normal of side i
      const x1 = cx + ox * (nt.pos - nt.half);
      const z1 = cz + oz * (nt.pos - nt.half);
      const x2 = cx + ox * (nt.pos + nt.half);
      const z2 = cz + oz * (nt.pos + nt.half);
      poly.push([x1, z1]);
      poly.push([x1 + nx * nt.depth, z1 + nz * nt.depth]);
      poly.push([x2 + nx * nt.depth, z2 + nz * nt.depth]);
      poly.push([x2, z2]);
    }
  }

  for (const p of poly) {
    p[0] += offX;
    p[1] += offZ;
  }
  const edges = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    edges.push({ ax, az, bx, bz, nx: (bz - az) / len, nz: -(bx - ax) / len, len });
  }
  return { poly, edges };
}

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Rejection-sample a point inside the floor polygon: up to 8 seeded tries
// against the (inset) bounding rect, centroid fallback. Consumption varies
// but stays deterministic — the polygon itself is seeded.
function randomPointInside(size, rand, inset = 0.3) {
  const { w, d, offX, offZ, poly } = size;
  const hx = Math.max(w / 2 - inset, 0.2);
  const hz = Math.max(d / 2 - inset, 0.2);
  for (let i = 0; i < 8; i++) {
    const x = offX + (rand() - 0.5) * 2 * hx;
    const z = offZ + (rand() - 0.5) * 2 * hz;
    if (pointInPolygon(x, z, poly)) return { x, z };
  }
  let cx = 0;
  let cz = 0;
  for (const p of poly) {
    cx += p[0];
    cz += p[1];
  }
  return { x: cx / poly.length, z: cz / poly.length };
}

// Seeded edge pick, weighted by length; edges shorter than minLen are
// skipped (longest-edge fallback if nothing qualifies).
function pickEdge(edges, rand, minLen = 0.5) {
  let usable = edges.filter((e) => e.len >= minLen);
  if (!usable.length) usable = [edges.reduce((a, b) => (a.len >= b.len ? a : b))];
  const total = usable.reduce((s, e) => s + e.len, 0);
  let roll = rand() * total;
  for (const e of usable) if ((roll -= e.len) <= 0) return e;
  return usable[usable.length - 1];
}

// True when (x,z) sits within `pad` of a placed wall prop's XZ footprint AND
// y is within `yBand` of its mount height — windows and facade details use
// this to stay out from underneath neon signs, billboards, and awnings.
function nearWallProp(x, z, y, placed, pad = 0.12, yBand = 0.55) {
  for (const p of placed) {
    if (p.mount !== "wall") continue;
    if (Math.hypot(x - p.x, z - p.z) < p.r + pad && Math.abs(y - p.y) < yBand) return true;
  }
  return false;
}

// Window lights along the outline edges — still one InstancedMesh per level
// (pane size variants ride the instance matrix scale). Each edge rolls a
// personality: ~25% stay blank, the rest pick 1-3 rows and a pane variant.
// Slots skip on seeded gaps (lone holes plus runs of 2-3) and near placed
// wall props, so facades read irregular and nothing glows under a sign.
function addWindows(group, edges, rand, bias = 0, placed = []) {
  const slots = [];
  for (const e of edges) {
    if (e.len <= 0.8) continue;
    if (rand() < 0.25) continue; // blank facade — no windows on this edge
    const pRoll = rand();
    const pane = pRoll < 0.3 ? PANES[0] : pRoll < 0.85 ? PANES[1] : PANES[2];
    let rowYs;
    if (pane.single) {
      rowYs = [0.7]; // shopfront band
    } else {
      const rows = 1 + Math.floor(rand() * 3);
      const start = Math.floor(rand() * (4 - rows));
      rowYs = [0.6, 1.2, 1.8].slice(start, start + rows);
    }
    const cols = Math.floor(e.len / pane.pitch);
    if (cols < 1) continue;
    const ux = (e.bx - e.ax) / e.len;
    const uz = (e.bz - e.az) / e.len;
    const ry = Math.atan2(e.nx, e.nz);
    const pad = (e.len - (cols - 1) * pane.pitch) / 2;
    for (const y of rowYs) {
      let run = 0; // remaining slots in a seeded dark streak
      for (let i = 0; i < cols; i++) {
        if (run > 0) {
          run--;
          continue;
        }
        const gap = rand();
        if (gap < 0.25) continue; // lone dark slot
        if (gap < 0.33) {
          run = 1 + Math.floor(rand() * 2); // streak: 2-3 slots total go dark
          continue;
        }
        const x = e.ax + ux * (pad + i * pane.pitch) + e.nx * 0.02;
        const z = e.az + uz * (pad + i * pane.pitch) + e.nz * 0.02;
        if (nearWallProp(x, z, y, placed)) continue;
        slots.push({ x, y, z, ry, sx: pane.w / 0.18, sy: pane.h / 0.26 });
      }
    }
  }
  if (slots.length > 150) slots.length = 150; // deterministic truncation
  if (!slots.length) return;

  const mesh = new THREE.InstancedMesh(WINDOW_GEO, WINDOW_MAT, slots.length);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    m.compose(pos.set(s.x, s.y, s.z), quat.setFromAxisAngle(UP, s.ry), scl.set(s.sx, s.sy, 1));
    mesh.setMatrixAt(i, m);
    const roll = rand();
    color.setHex(roll < WINDOW_LIT_RATE ? windowColor(roll / WINDOW_LIT_RATE, bias) : WINDOW_DARK);
    mesh.setColorAt(i, color);
  }
  group.add(mesh);
  windowMeshes.push({ mesh, y: group.position.y, bias });
}

// Facade detailing: cheap frozen geometry flush against the walls (cladding
// patches, duct runs, diagonal braces, vent grilles) so faces between
// windows read built instead of blank. Collision-exempt — they only dodge
// placed wall props, reusing the window exclusion test with a wider pad.
function addFacadeDetails(group, edges, rand, family, placed) {
  const perimeter = edges.reduce((s, e) => s + e.len, 0);
  const budget = Math.floor(perimeter / 4);
  const tint = (dl, ds = 0) =>
    new THREE.MeshLambertMaterial({ color: familyColor(family, rand).offsetHSL(0, ds, dl) });
  for (let n = 0; n < budget; n++) {
    const e = pickEdge(edges, rand, 1.0);
    const ux = (e.bx - e.ax) / e.len;
    const uz = (e.bz - e.az) / e.len;
    const ry = Math.atan2(e.nx, e.nz);
    const t = 0.2 + rand() * 0.6; // stay off the corners
    const px = e.ax + ux * e.len * t;
    const pz = e.az + uz * e.len * t;
    const kind = rand();
    let obj;
    let y;
    let off; // outward shift along the normal (keeps the back face buried)
    let tilt = 0;
    if (kind < 0.4) {
      // cladding patch: slightly proud box, darker or lighter than the slab
      const cw = 0.6 + rand() * 0.8;
      const ch = 0.4 + rand() * 0.5;
      obj = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, 0.05), tint(rand() < 0.5 ? -0.05 : 0.05));
      y = 0.5 + rand() * 1.3;
      off = 0.015;
    } else if (kind < 0.6) {
      // horizontal duct run along the edge with 1-2 elbow stubs dropping off
      obj = new THREE.Group();
      const len = Math.max(0.5, Math.min(e.len - 0.4, 0.9 + rand() * 1.1));
      const mat = tint(0.03, -0.08);
      const duct = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.09), mat);
      obj.add(duct);
      const stubs = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < stubs; i++) {
        const stub = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.09), mat);
        stub.position.set((i === 0 ? -1 : 1) * (len / 2 - 0.045), -0.17, 0);
        obj.add(stub);
      }
      y = 0.4 + rand() * 1.5;
      off = 0.035;
    } else if (kind < 0.8) {
      // diagonal brace: thin box tilted ~±0.6 rad in the wall plane
      const len = 0.8 + rand() * 0.8;
      obj = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.04), tint(-0.04));
      y = 0.7 + rand();
      off = 0.01;
      tilt = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.2);
    } else {
      // vent grille: small dark box with 2-3 darker slats
      obj = new THREE.Group();
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.24, 0.04),
        new THREE.MeshLambertMaterial({ color: 0x1c1c24 })
      );
      obj.add(back);
      const slats = 2 + Math.floor(rand() * 2);
      const slatMat = new THREE.MeshLambertMaterial({ color: 0x101018 });
      for (let i = 0; i < slats; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.01), slatMat);
        slat.position.set(0, (i - (slats - 1) / 2) * 0.07, 0.025);
        obj.add(slat);
      }
      y = 0.6 + rand() * 1.2;
      off = 0.01;
    }
    if (nearWallProp(px, pz, y, placed, 0.4)) continue; // rand stays consumed — deterministic
    obj.position.set(px + e.nx * off, y, pz + e.nz * off);
    // Euler XYZ applies Z first: tilt in the wall plane, then face the normal
    obj.rotation.set(0, ry, tilt);
    group.add(obj);
  }
}

// Ambient life: every ~0.5s one window near the camera flips lit/dark.
// Frame-time only, so Math.random is allowed (see the props.js RNG contract).
function windowFlickerTick() {
  const c = new THREE.Color();
  let next = 0;
  return (t) => {
    if (t < next) return;
    next = t + 0.4 + Math.random() * 0.25;
    const near = windowMeshes.filter((wm) => Math.abs(wm.y - camera.position.y) < 18);
    if (!near.length) return;
    const { mesh, bias } = near[Math.floor(Math.random() * near.length)];
    const i = Math.floor(Math.random() * mesh.count);
    mesh.getColorAt(i, c);
    c.setHex(c.r > 0.3 ? WINDOW_DARK : windowColor(Math.random(), bias));
    mesh.setColorAt(i, c);
    mesh.instanceColor.needsUpdate = true;
  };
}

// Decorates a level and returns the `placed` footprint list so the window
// and facade passes that follow can stay clear of the props.
function decorate(group, level, rand, startIso) {
  const size = group.userData.size;
  const levelDate = startIso ? dateOfDay(startIso, level.day) : "2026-06-10";
  const available = propsAvailableOn(PROPS, levelDate);
  const placed = []; // { x, z, y, r, mount } footprints already claimed on this level

  // Geometry-scaled budgets so big plates don't read empty: walls earn props
  // by perimeter, roofs by floor area, ledges keep the old flat roll. Each
  // takes a seeded ±1 jitter; the sum is capped (trim the largest) at 18.
  const perimeter = size.edges.reduce((s, e) => s + e.len, 0);
  const area = polygonArea(size.poly);
  const jitter = () => Math.floor(rand() * 3) - 1;
  const budgets = {
    wall: Math.max(0, 2 + Math.floor(perimeter / 3.5) + jitter()),
    roof: Math.max(0, 1 + Math.floor(area / 8) + jitter()),
    ledge: Math.max(0, 5 + Math.floor(rand() * 6) + jitter()),
  };
  while (budgets.wall + budgets.roof + budgets.ledge > 18) {
    const top = ["wall", "roof", "ledge"].reduce((a, b) => (budgets[a] >= budgets[b] ? a : b));
    budgets[top]--;
  }

  for (const mount of ["wall", "roof", "ledge"]) {
    const pool = available.filter((p) => p.mount === mount);
    const poolWeight = pool.reduce((s, p) => s + p.weight, 0);
    if (!poolWeight) continue;
    for (let i = 0; i < budgets[mount]; i++) {
      let roll = rand() * poolWeight;
      const prop = pool.find((p) => (roll -= p.weight) <= 0) ?? pool[0];
      const obj = prop.build(THREE, rand, { w: size.w, d: size.d });
      obj.scale.setScalar(PROP_SCALE);
      if (!placeProp(obj, prop.mount, size, rand, prop.radius * PROP_SCALE, placed)) continue; // skip overlaps
      group.add(obj);
      if (obj.userData.tick) ticks.push(obj.userData.tick);
    }
  }

  // Furnish every terrace so no deck reads as bare: one people group plus 1-3
  // weighted ledge props from the date-gated library, packed tighter (0.85 of
  // the usual footprint) with extra placement retries.
  if (size.terrace && available.length) {
    const ledge = available.filter((p) => p.mount === "ledge");
    const ledgeWeight = ledge.reduce((s, p) => s + p.weight, 0);
    const furnishings = [];
    const people = available.find((p) => p.name === "people");
    if (people) furnishings.push(people);
    const extra = 1 + Math.floor(rand() * 3); // 1-3 additional ledge props
    for (let i = 0; i < extra && ledgeWeight; i++) {
      let roll = rand() * ledgeWeight;
      furnishings.push(ledge.find((p) => (roll -= p.weight) <= 0) ?? ledge[0]);
    }
    for (const prop of furnishings) {
      const obj = prop.build(THREE, rand, { w: size.w, d: size.d });
      obj.scale.setScalar(PROP_SCALE);
      if (placeOnTerrace(obj, size.terrace, rand, prop.radius * PROP_SCALE * 0.85, placed, 10)) {
        group.add(obj);
        if (obj.userData.tick) ticks.push(obj.userData.tick);
      }
    }
  }

  for (const missDay of level.scars) addScar(group, size, missDay);
  return placed;
}

// A candidate (x,z,y,r) collides if any prior footprint is closer than the
// summed radii in XZ AND within a 0.45 vertical band (so a wall sign can sit
// above an awning). Surface props share roof height, so for them it reduces
// to a pure XZ separation test.
function collides(x, z, y, r, placed) {
  for (const p of placed) {
    if (Math.hypot(x - p.x, z - p.z) < r + p.r && Math.abs(y - p.y) < 0.45) return true;
  }
  return false;
}

function placeOnTerrace(obj, t, rand, radius, placed, tries = 6) {
  // Re-roll a clear spot up to `tries` times; skip the prop if the deck is full.
  for (let attempt = 0; attempt < tries; attempt++) {
    const x = t.x + (rand() - 0.5) * Math.max(t.w - 0.5, 0.2);
    const z = t.z + (rand() - 0.5) * Math.max(t.d - 0.5, 0.2);
    const y = SLAB_TOP + 0.08;
    const ry = rand() * Math.PI * 2;
    if (collides(x, z, y, radius, placed)) continue;
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    placed.push({ x, z, y, r: radius, mount: "ledge" });
    return true;
  }
  return false;
}

function placeProp(obj, mount, size, rand, radius, placed) {
  if (mount === "ledge" && size.terrace) {
    return placeOnTerrace(obj, size.terrace, rand, radius, placed);
  }
  // Roll a candidate exactly as before; re-roll on collision (consuming seeded
  // rand deterministically) up to 6 times, then skip if it never clears.
  for (let attempt = 0; attempt < 6; attempt++) {
    let x;
    let y;
    let z;
    let ry;
    if (mount === "roof") {
      const p = randomPointInside(size, rand);
      x = p.x;
      z = p.z;
      y = SLAB_TOP;
      ry = rand() * Math.PI * 2;
    } else {
      // wall + terrace-less ledge props hang off a real outline edge so nothing
      // floats over chamfered/notched air
      const e = pickEdge(size.edges, rand);
      const m = Math.min(0.4, 0.45 / e.len);
      const t = m + rand() * (1 - 2 * m);
      const ex = e.ax + (e.bx - e.ax) * t;
      const ez = e.az + (e.bz - e.az) * t;
      if (mount === "wall") {
        x = ex + e.nx * 0.04;
        y = LEVEL_H * (0.35 + rand() * 0.4);
        z = ez + e.nz * 0.04;
        ry = Math.atan2(e.nx, e.nz); // +z faces along the outward normal
      } else {
        // no terrace on this level: perch on the roof edge, facing the interior
        x = ex - e.nx * 0.3;
        y = SLAB_TOP;
        z = ez - e.nz * 0.3;
        ry = Math.atan2(-e.nx, -e.nz);
      }
    }
    if (collides(x, z, y, radius, placed)) continue;
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    placed.push({ x, z, y, r: radius, mount });
    return true;
  }
  return false;
}

function addScar(group, size, missDay) {
  const rand = mulberry32(missDay * 7919 + 13);
  // scorch patches on the roof + one dangling rebar, all inside the outline
  for (let i = 0; i < 3; i++) {
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 + rand() * 0.6, 0.06, 0.3 + rand() * 0.6),
      new THREE.MeshLambertMaterial({ color: 0x0c0a10 })
    );
    const p = randomPointInside(size, rand, 0.25);
    patch.position.set(p.x, SLAB_TOP + 0.03, p.z);
    group.add(patch);
  }
  const rebar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4),
    new THREE.MeshLambertMaterial({ color: 0x3a3026 })
  );
  const rp = randomPointInside(size, rand, 0.1);
  rebar.position.set(rp.x, SLAB_TOP + 0.3, rp.z);
  rebar.rotation.z = 0.4 + rand() * 0.5;
  group.add(rebar);

  // smoke: three slow-rising translucent planes
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0x555566, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
  });
  const puffs = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), smokeMat.clone());
    const sp = randomPointInside(size, rand, 0.5);
    puff.position.set(sp.x, LEVEL_H, sp.z);
    puff.userData.animated = true; // tick rises + billboards it
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

function addRubble(count) {
  const rand = mulberry32(424242);
  for (let i = 0; i < Math.min(count, 40); i++) {
    const s = 0.2 + rand() * 0.5;
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * 0.6, s),
      new THREE.MeshLambertMaterial({ color: 0x232030 })
    );
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 5;
    chunk.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
    chunk.rotation.y = rand() * Math.PI;
    scene.add(chunk);
  }
}

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
        const r = 9 + rand() * 5;
        cloud.position.set(Math.cos(a) * r, y + (rand() - 0.5), Math.sin(a) * r);
        scene.add(cloud);
      }
    } else if (kind === 1) {
      // weather balloon tethered beside the tower
      const balloon = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 8, 8),
        new THREE.MeshLambertMaterial({ color: 0xbb4455 })
      );
      balloon.position.set(8, y, 2);
      balloon.userData.animated = true; // tick bobs it
      scene.add(balloon);
      ticks.push((t) => { balloon.position.y = y + Math.sin(t * 0.5 + lvl) * 0.4; });
    } else {
      // dead satellite drifting in a slow circle
      const sat = new THREE.Group();
      const bus = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.6), new THREE.MeshLambertMaterial({ color: 0x777788 }));
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.02, 0.5), new THREE.MeshLambertMaterial({ color: 0x2244aa }));
      sat.add(bus, panel);
      sat.userData.animated = true; // tick orbits the group (children stay frozen)
      scene.add(sat);
      ticks.push((t) => {
        const a = t * 0.1 + lvl;
        sat.position.set(Math.cos(a) * 13, y, Math.sin(a) * 13);
        sat.rotation.y = a;
      });
    }
  }
}

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
    drone.userData.animated = true; // tick ferries the group
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
  elevator.userData.animated = true; // tick crawls it up the face
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
    seeds.push({ x: (rand() - 0.5) * 32, z: (rand() - 0.5) * 32, off: rand() * 30, sp: 9 + rand() * 5 });
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: 0x445066, transparent: true, opacity: 0.5 })
  );
  rain.userData.animated = true; // tick rewrites the geometry, not the matrix — marked to be safe
  scene.add(rain);
  ticks.push((t) => {
    for (let i = 0; i < RAIN; i++) {
      const s = seeds[i];
      const y = camera.position.y + 17 - ((t * s.sp + s.off) % 34);
      rp[i * 6] = s.x; rp[i * 6 + 1] = y; rp[i * 6 + 2] = s.z;
      rp[i * 6 + 3] = s.x; rp[i * 6 + 4] = y - 0.5; rp[i * 6 + 5] = s.z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  });
}

function wayPoint(rand, towerTop) {
  const a = rand() * Math.PI * 2;
  const r = 6 + rand() * 7;
  return new THREE.Vector3(Math.cos(a) * r, 1 + rand() * towerTop, Math.sin(a) * r);
}

function addMoonAndStars(height) {
  const moonY = MOON_LEVEL * LEVEL_H;
  // Sky moon: rendered camera-relative like a real celestial object, so the
  // goal is visible from any height. It drifts closer and looms larger as
  // the tower's height approaches MOON_LEVEL.
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xd8d8c8, fog: false })
  );
  moon.userData.animated = true; // tick keeps it camera-relative
  scene.add(moon);
  const progress = Math.min(height / MOON_LEVEL, 1);
  const dist = 220 - 140 * progress;
  const scale = 8 + 18 * progress;
  moon.scale.setScalar(scale);
  ticks.push(() => {
    moon.position.set(
      camera.position.x - dist * 0.45,
      camera.position.y + dist * 0.42,
      camera.position.z - dist * 0.8
    );
  });

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

function setupControls() {
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 45; // fog starts eating the world at ~48
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.screenSpacePanning = true; // vertical pan moves along camera-up = climbs
  controls.keyPanSpeed = 30;
  controls.listenToKeyEvents(window); // arrow keys pan/climb
  // start near the top, like the old fixed orbit did
  controls.target.set(0, Math.max(4, topY - 2), 0);
  camera.position.set(19, controls.target.y + 1, 0);

  // shift+scroll climbs the tower (capture phase beats OrbitControls' zoom)
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const dy = (e.deltaY || e.deltaX) * 0.03; // some platforms remap shift+wheel to deltaX
      controls.target.y -= dy;
      camera.position.y -= dy;
    },
    { capture: true, passive: false }
  );

  // idle auto-orbit: pause on interaction, resume after 15s of quiet
  let idleTimer = 0;
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { controls.autoRotate = true; }, 15000);
  });
}

function resize() {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  renderer.setSize(INTERNAL_WIDTH, Math.round((INTERNAL_WIDTH * h) / w), false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let rafId = 0;

function schedule() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});

function frame(ms) {
  rafId = 0;
  if (document.hidden) return;
  const t = ms / 1000;
  controls.update();
  // keep the orbit pivot glued to the tower axis: lateral pan is allowed only
  // a little (framing), so one-finger drag always orbits around the tower;
  // shift the camera by the same correction so the view doesn't tilt
  const tx = Math.min(Math.max(controls.target.x, -2.5), 2.5);
  const ty = Math.min(Math.max(controls.target.y, 1), topY + 8);
  const tz = Math.min(Math.max(controls.target.z, -2.5), 2.5);
  camera.position.x += tx - controls.target.x;
  camera.position.y += ty - controls.target.y;
  camera.position.z += tz - controls.target.z;
  controls.target.set(tx, ty, tz);
  // while idle, ease the pivot back onto the axis (no camera compensation:
  // this intentionally re-frames the tower to center)
  if (controls.autoRotate) {
    controls.target.x *= 0.98;
    controls.target.z *= 0.98;
  }
  for (const tick of ticks) tick(t);
  renderer.render(scene, camera);
  schedule();
}
