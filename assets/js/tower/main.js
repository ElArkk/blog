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
// far plane reaches the moon (~level 365 * LEVEL_H) so the goal is always visible
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);

const ticks = []; // per-frame animation callbacks: fn(t)
let topY = LEVEL_H; // camera clamp ceiling, set by buildWorld

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
  setupCameraControls();
  resize();
  addEventListener("resize", resize);
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
  addMilestones(levels.length);

  addRubble(rubble);
  addMoonAndStars(levels.length);
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
  decorate(group, level, rand, startIso);
  return group;
}

function decorate(group, level, rand, startIso) {
  const { w, d } = group.userData.size;
  const levelDate = startIso ? dateOfDay(startIso, level.day) : "2026-06-10";
  const available = propsAvailableOn(PROPS, levelDate);
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  const count = totalWeight ? 2 + Math.floor(rand() * 4) : 0; // 2-5 props per spec

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

function addMoonAndStars(height) {
  const moonY = MOON_LEVEL * LEVEL_H;
  // Sky moon: rendered camera-relative like a real celestial object, so the
  // goal is visible from any height. It drifts closer and looms larger as
  // the tower's height approaches MOON_LEVEL.
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xd8d8c8, fog: false })
  );
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
    if (dragging !== null && !e.buttons) {
      dragging = null;
      return;
    }
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
  camAngle = t * 0.06;
  const r = 13;
  camera.position.set(Math.sin(camAngle) * r, camY + Math.sin(t * 0.4) * 0.4, Math.cos(camAngle) * r);
  camera.lookAt(0, camY, 0);
  for (const tick of ticks) tick(t);
  renderer.render(scene, camera);
  schedule();
}
