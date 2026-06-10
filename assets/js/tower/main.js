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
