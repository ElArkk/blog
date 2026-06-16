// Hand-built low-poly prop library for the Tower renderer.
//
// Prop contract (main.js relies on this; follow it when adding props):
// - { name, addedOn, mount: "wall"|"roof"|"ledge", weight, radius, build }
// - build(T, rand) -> T.Group with its origin at the mount point; the
//   caller (main.js) positions and orients the group on the level.
// - radius: approximate XZ footprint (number, level-local units). main.js
//   uses it for anti-collision placement so props don't clip; size it to the
//   widest part of the build so neighbours keep clear.
// - Animated props set group.userData.tick = (t) => {} (t = seconds).
// - RNG boundary: `rand` (seeded, deterministic) is for BUILD-TIME
//   structure only; Math.random() is for FRAME-TIME animation only.
//   Never call `rand` inside a tick closure — structure must replay
//   identically on every page load.
// - addedOn date-gates the prop: levels only use props that existed on
//   the level's real date, so old floors never change as this list grows.

export const NEON = [
  0xff2d78, 0x00e5ff, 0x9d4dff, 0x00ff9c, 0xffb300,
  0xff7a1a, 0xc8ff3a, 0xfff0e0, // orange, lime, warm white
];

// Muted clothing palette: greys, browns, navy, dark green, dusty red,
// plus tan, slate blue, plum, faded teal.
const CLOTH = [
  0x4a4a52, 0x3a3a42, 0x5a4632, 0x6a5238, 0x2a2e44, 0x2e3a2c, 0x6a3a3a,
  0x8a7a5a, 0x46506a, 0x5a3a52, 0x3a5a55,
];

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

function glowBox(T, w, h, d, color) {
  // Emissive-looking unlit box (held item / neon accent piece).
  return new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial({ color }));
}

function pickNeon(rand) {
  return NEON[Math.floor(rand() * NEON.length)];
}

// Seeded per-channel colour drift: jitters an RGB hex multiplicatively so a
// flat constant gains muted variation without leaving its palette. Build-time
// only (uses `rand`); never call inside a tick.
function drift(hex, rand, amt = 0.12) {
  const ch = (shift) => {
    const v = Math.round(((hex >> shift) & 0xff) * (1 + (rand() - 0.5) * 2 * amt));
    return Math.min(255, Math.max(0, v));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function flicker(mesh, offRate = 0.01) {
  // Frame-time animation: Math.random() only (see RNG boundary above).
  let cool = 0;
  return () => {
    if (cool-- > 0) return;
    if (Math.random() < offRate) {
      mesh.visible = !mesh.visible;
      cool = mesh.visible ? 0 : 4 + Math.floor(Math.random() * 6);
    } else if (!mesh.visible) {
      mesh.visible = true;
    }
  };
}

// --- figures: a Ghost-in-the-Shell-flavoured crowd ---
//
// Dim skin-ish head tones; reads dark at distance.
const SKIN = [0x6a5a50, 0x5e4f46, 0x74604f, 0x55483f, 0x6f5a4a, 0x7c6552];
// Brushed-metal limb/chassis tones for cyborgs, androids and bots.
const METAL = [0x6a6e78, 0x565a62, 0x7c808a, 0x4c4f57, 0x868a94];

// One humanoid (~0.5 tall pre-scale) with segmented legs/arms, neck, head and
// optional trench coat + accessories. `kind` drives materials:
//   human   -> cloth limbs, skin face, hair
//   cyborg  -> cloth torso, ~half the limbs swapped for metal, glowing visor,
//              neck ports, optional sensor stalk (the GitS prosthetic look)
//   android -> all-metal chassis, glowing core seam + visor, smooth crown
// Returns { fig, sitting, rightPivot } so the caller can pose the crowd and
// wire one shared animation tick (gesture / walk).
function buildFigure(T, rand, kind) {
  const fig = new T.Group();
  const synthetic = kind === "android";
  const broad = rand() < 0.4;
  const w = broad ? 0.085 + rand() * 0.03 : 0.058 + rand() * 0.02;
  const d = broad ? 0.062 : 0.046;
  const tall = 0.24 + rand() * 0.12;
  const sitting = rand() < 0.22;

  const cloth = CLOTH[Math.floor(rand() * CLOTH.length)];
  const trouser = CLOTH[Math.floor(rand() * CLOTH.length)];
  const skin = SKIN[Math.floor(rand() * SKIN.length)];
  const metal = METAL[Math.floor(rand() * METAL.length)];
  const seam = pickNeon(rand);
  // per-limb hex: androids all metal; cyborgs ~half metal (asymmetric prosthetics)
  const limbHex = () =>
    synthetic || (kind === "cyborg" && rand() < 0.5)
      ? drift(metal, rand, 0.1)
      : drift(trouser, rand, 0.12);
  const legHex = limbHex();
  const faceHex = synthetic ? drift(metal, rand, 0.08) : skin;

  // vertical budget (sitting compresses the legs and drops everything onto a stool)
  const legH = tall * (sitting ? 0.4 : 0.46);
  const thighH = legH * 0.52;
  const shinH = legH * 0.46;
  const hipH = tall * 0.12;
  const torsoH = tall * 0.46;
  const neckH = tall * 0.07;
  const headS = w * 0.76;
  const hipY = sitting ? tall * 0.2 + hipH / 2 : legH + hipH / 2;
  const torsoBase = hipY + hipH / 2;
  const shoulderY = torsoBase + torsoH * 0.86;
  const neckY = torsoBase + torsoH + neckH / 2;
  const headY = neckY + neckH / 2 + headS / 2;
  const headTop = headY + headS / 2;

  // legs: thigh + shin + foot
  const legW = w * 0.4;
  for (const sx of [-1, 1]) {
    const thigh = box(T, legW, thighH, d * 0.85, legHex);
    const shin = box(T, legW * 0.88, shinH, d * 0.8, legHex);
    const foot = box(T, legW, 0.02, d * 1.5, 0x1c1c22);
    if (sitting) {
      thigh.position.set(sx * w * 0.24, hipY - hipH * 0.2, d * 0.5);
      thigh.rotation.x = -1.35; // thigh forward
      shin.position.set(sx * w * 0.24, hipY - thighH * 0.5, d * 0.95);
      foot.position.set(sx * w * 0.24, 0.01, d * 1.1);
      const stoolH = tall * 0.2;
      const stool = box(T, w * 1.2, stoolH, d * 1.3, 0x3a2f28);
      stool.position.set(sx * 0, stoolH / 2, 0);
      if (sx < 0) fig.add(stool);
    } else {
      const lean = (rand() - 0.5) * 0.16;
      thigh.position.set(sx * w * 0.24, legH - thighH / 2, 0);
      thigh.rotation.z = lean;
      shin.position.set(sx * w * 0.24 + Math.sin(lean) * thighH, shinH / 2, 0);
      foot.position.set(sx * w * 0.24 + Math.sin(lean) * thighH, 0.01, d * 0.35);
    }
    fig.add(thigh, shin, foot);
  }

  // hip + torso (+ optional GitS trench skirt)
  const hip = box(T, w, hipH, d, drift(trouser, rand, 0.1));
  hip.position.y = hipY;
  const torso = box(T, w, torsoH, d, synthetic ? drift(metal, rand, 0.1) : drift(cloth, rand, 0.12));
  torso.position.y = torsoBase + torsoH / 2;
  fig.add(hip, torso);
  if (!sitting && rand() < 0.4) {
    const skirtH = torsoH * (0.7 + rand() * 0.5);
    const skirt = box(T, w * 1.14, skirtH, d * 1.16, drift(cloth, rand, 0.1));
    skirt.position.y = hipY - skirtH * 0.3;
    fig.add(skirt);
  }
  // glowing core seam down the chest (synth + cyborg)
  if (synthetic || kind === "cyborg") {
    const core = glowBox(T, w * 0.18, torsoH * 0.42, 0.012, seam);
    core.position.set(0, torsoBase + torsoH * 0.55, d / 2 + 0.005);
    fig.add(core);
  }

  // neck + head
  const neck = box(T, w * 0.4, neckH, d * 0.5, faceHex);
  neck.position.y = neckY;
  const head = box(T, headS, headS, headS * 0.92, faceHex);
  head.position.y = headY;
  fig.add(neck, head);
  // face: glowing visor for synth/cyborg, occasional glasses for humans
  if (synthetic || kind === "cyborg" || rand() < 0.25) {
    const visor = glowBox(T, headS * 0.84, headS * 0.22, 0.01, synthetic || kind === "cyborg" ? seam : 0x9fefff);
    visor.position.set(0, headY + headS * 0.05, headS * 0.46);
    fig.add(visor);
  }
  // hair (organic) or smooth crown (android)
  if (synthetic) {
    const crown = new T.Mesh(
      new T.SphereGeometry(headS * 0.5, 6, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      lambert(T, drift(metal, rand, 0.06))
    );
    crown.position.y = headY + headS * 0.42;
    fig.add(crown);
  } else if (rand() < 0.85) {
    const hairCol = [0x14131a, 0x1d1822, 0x2a211c, 0x3a2f2a][Math.floor(rand() * 4)];
    const hair = box(T, headS * 1.08, headS * (0.4 + rand() * 0.4), headS * 1.08, hairCol);
    hair.position.y = headY + headS * 0.34;
    fig.add(hair);
  }
  // sensor stalk (some synths)
  if ((synthetic || kind === "cyborg") && rand() < 0.4) {
    const ant = box(T, 0.01, headS * 0.7, 0.01, drift(metal, rand, 0.1));
    ant.position.set(headS * 0.3, headTop + headS * 0.3, 0);
    const tip = new T.Mesh(new T.SphereGeometry(0.012, 5, 4), new T.MeshBasicMaterial({ color: seam }));
    tip.position.set(headS * 0.3, headTop + headS * 0.62, 0);
    fig.add(ant, tip);
  }
  // cyberbrain neck ports (cyborg)
  if (kind === "cyborg" && rand() < 0.6) {
    for (let i = 0; i < 2; i++) {
      const port = new T.Mesh(new T.SphereGeometry(0.01, 4, 4), new T.MeshBasicMaterial({ color: seam }));
      port.position.set((i - 0.5) * headS * 0.3, neckY, -d * 0.32);
      fig.add(port);
    }
  }
  // ~30% hat / hood, clothing-coloured (silhouette stays dark)
  if (!synthetic && rand() < 0.35) {
    let hat;
    if (rand() < 0.5) {
      hat = box(T, headS * 1.25, headS * 0.45, headS * 1.25, cloth);
      hat.position.y = headY + headS * 0.42;
    } else {
      hat = new T.Mesh(new T.CylinderGeometry(headS * 0.55, headS * 0.7, headS * 0.6, 6), lambert(T, cloth));
      hat.position.y = headY + headS * 0.22;
    }
    fig.add(hat);
  }

  // arms: upper + fore + hand on a shoulder pivot; right pivot is returned so
  // the caller can animate a gesture. One pose is picked for the whole figure.
  const armW = Math.max(0.022, w * 0.26);
  const upperH = torsoH * 0.5;
  const foreH = torsoH * 0.46;
  const pose = rand();
  let rightPivot = null;
  for (const sx of [-1, 1]) {
    const pivot = new T.Group();
    const upper = box(T, armW, upperH, armW, limbHex());
    upper.position.y = -upperH / 2;
    const fore = box(T, armW * 0.9, foreH, armW * 0.9, limbHex());
    fore.position.y = -upperH - foreH / 2;
    const hand = box(T, armW * 1.1, armW * 1.1, armW * 1.1, faceHex);
    hand.position.y = -upperH - foreH;
    pivot.add(upper, fore, hand);
    pivot.position.set(sx * (w / 2 + armW * 0.4), shoulderY, 0);
    if (pose < 0.3 && sx > 0) pivot.rotation.z = 1.4; // arm out
    else if (pose < 0.5 && sx > 0) pivot.rotation.z = 2.5; // raised
    else if (pose < 0.7 && sx > 0) { pivot.rotation.z = 0.5; pivot.rotation.x = -0.6; } // crooked / holding
    else pivot.rotation.z = sx * -0.07; // hanging with a slight flare
    // glowing AR device in a raised hand
    if (pose < 0.5 && sx > 0 && rand() < 0.4) {
      const dev = glowBox(T, 0.04, 0.05, 0.012, 0x9fefff);
      dev.position.y = -upperH - foreH - 0.02;
      pivot.add(dev);
    }
    fig.add(pivot);
    if (sx > 0) rightPivot = pivot;
  }

  // accessory: satchel on a strap, or a backpack
  const acc = rand();
  if (acc < 0.3) {
    const strap = box(T, w * 1.3, 0.012, d * 0.4, 0x222026);
    strap.position.y = torsoBase + torsoH * 0.5;
    strap.rotation.z = 0.5;
    const bag = box(T, w * 0.7, w * 0.85, d * 0.7, drift(cloth, rand, 0.12));
    bag.position.set(-w * 0.6, torsoBase + torsoH * 0.1, 0);
    fig.add(strap, bag);
  } else if (acc < 0.48) {
    const pack = box(T, w * 0.92, torsoH * 0.7, d * 0.7, drift(cloth, rand, 0.1));
    pack.position.set(0, torsoBase + torsoH * 0.5, -d * 0.8);
    fig.add(pack);
  }
  // ~25% scarf
  if (!synthetic && rand() < 0.25) {
    const scarf = box(T, w * 1.06, neckH * 1.8, d * 1.12, drift(cloth, rand, 0.15));
    scarf.position.y = neckY - neckH * 0.2;
    fig.add(scarf);
  }
  // ~10% umbrella
  if (rand() < 0.1) {
    const ucol = rand() < 0.5 ? 0x2a2a30 : 0x8a3a3a;
    const top = headTop + 0.14;
    const base = shoulderY * 0.4;
    const shaftH = top - base;
    const shaft = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, shaftH, 6), lambert(T, 0x33333a));
    shaft.position.set(w * 0.6, base + shaftH / 2, d * 0.3);
    const canopy = new T.Mesh(new T.CylinderGeometry(0.001, 0.18, 0.08, 6), lambert(T, ucol));
    canopy.position.set(w * 0.6, top, d * 0.3);
    fig.add(shaft, canopy);
  }

  if (!sitting) fig.rotation.z = (rand() - 0.5) * 0.1; // subtle standing lean
  return { fig, sitting, rightPivot };
}

// Tachikoma/Fuchikoma-style think-tank: rounded chassis on four splayed legs
// with a cluster of glowing eye lenses. ~0.3 tall. Static (reads as a parked
// spider-tank); the glow does the work.
function buildThinkTank(T, rand) {
  const g = new T.Group();
  const body = drift(rand() < 0.6 ? 0x3a6a8a : 0x6a6e78, rand, 0.12); // GitS blue or steel grey
  const eye = pickNeon(rand);
  const r = 0.13 + rand() * 0.04;
  const legH = 0.14 + rand() * 0.05;
  const hull = box(T, r * 1.9, r * 1.1, r * 1.7, body);
  hull.position.y = legH + r * 0.55;
  const dome = new T.Mesh(
    new T.SphereGeometry(r * 0.95, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    lambert(T, body)
  );
  dome.position.y = legH + r * 1.1;
  g.add(hull, dome);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const upper = new T.Mesh(new T.CylinderGeometry(0.018, 0.016, legH * 0.7, 5), lambert(T, drift(0x55585f, rand, 0.1)));
    upper.position.set(sx * r * 0.9, legH * 0.65, sz * r * 0.9);
    upper.rotation.z = -sx * 0.5;
    upper.rotation.x = sz * 0.5;
    const foot = new T.Mesh(new T.CylinderGeometry(0.016, 0.022, legH * 0.7, 5), lambert(T, drift(0x44474d, rand, 0.1)));
    foot.position.set(sx * r * 1.5, legH * 0.35, sz * r * 1.5);
    g.add(upper, foot);
  }
  const eyes = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < eyes; i++) {
    const lens = new T.Mesh(new T.SphereGeometry(0.022, 6, 6), new T.MeshBasicMaterial({ color: eye }));
    lens.position.set(-0.05 + i * 0.05, legH + r * 0.7, r * 0.88);
    g.add(lens);
  }
  if (rand() < 0.5) {
    const turret = box(T, 0.03, 0.03, 0.16, drift(0x44474d, rand, 0.1));
    turret.position.set(0, legH + r * 1.15, r * 0.4);
    turret.rotation.x = -0.3;
    g.add(turret);
  }
  return g;
}

export const PROPS = [
  {
    name: "neon-sign",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 3,
    radius: 0.35,
    build(T, rand) {
      const g = new T.Group();
      const w = 0.5 + rand() * 1.1;
      const h = 0.4 + rand() * 0.5;
      const sign = glow(T, w, h, pickNeon(rand));
      const backing = box(T, w + 0.1, h + 0.1, 0.06, 0x16161f);
      backing.position.z = -0.04;
      g.add(backing, sign);
      g.userData.tick = flicker(sign);
      return g;
    },
  },
  {
    name: "holo-billboard",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 2,
    radius: 0.5,
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
    radius: 0.3,
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
    radius: 0.15,
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
    radius: 0.3,
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
    radius: 0.15,
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
    radius: 0.4,
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
    radius: 0.25,
    build(T, rand) {
      const g = new T.Group();
      const body = box(T, 0.32, 0.6, 0.3, drift(0x28283a, rand, 0.18));
      body.position.y = 0.3;
      const front = glow(T, 0.2, 0.42, pickNeon(rand));
      front.position.set(0, 0.32, 0.151);
      g.add(body, front);
      g.userData.tick = flicker(front, 0.004);
      return g;
    },
  },
  {
    name: "noodle-stand",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 2,
    radius: 0.45,
    build(T, rand) {
      const g = new T.Group();
      const counter = box(T, 0.7, 0.3, 0.35, drift(0x4a3a30, rand, 0.15));
      counter.position.y = 0.15;
      const roofTop = box(T, 0.8, 0.05, 0.45, drift(0xa33a3a, rand, 0.18));
      roofTop.position.y = 0.72;
      for (const x of [-0.34, 0.34]) {
        const leg = box(T, 0.04, 0.45, 0.04, 0x33282a);
        leg.position.set(x, 0.5, 0.14);
        g.add(leg);
      }
      const lantern = glow(T, 0.1, 0.16, 0xffb300);
      lantern.position.set(0.3, 0.55, 0.24);
      g.add(counter, roofTop, lantern);
      g.userData.tick = flicker(lantern, 0.003);
      return g;
    },
  },
  {
    name: "people",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 5,
    radius: 0.5,
    build(T, rand) {
      const g = new T.Group();
      // Group size varies so decks aren't all even clusters: ~30% loners,
      // ~30% pairs, ~25% small groups, ~15% bigger crowds. Many people-prop
      // instances per level then scatter these across the available ledges.
      const r = rand();
      const n = r < 0.3 ? 1 : r < 0.6 ? 2 : r < 0.85 ? 3 + Math.floor(rand() * 2) : 5 + Math.floor(rand() * 3);
      const spacing = n > 3 ? 0.18 : 0.22;
      const nodes = [];
      for (let i = 0; i < n; i++) {
        const roll = rand();
        let node;
        if (roll < 0.08) {
          node = buildThinkTank(T, rand); // a Tachikoma loiters on the deck
        } else {
          const kind = roll < 0.5 ? "human" : roll < 0.75 ? "cyborg" : "android";
          node = buildFigure(T, rand, kind).fig;
        }
        node.position.set(
          (i - (n - 1) / 2) * spacing + (rand() - 0.5) * 0.06, // centred row
          0,
          (rand() - 0.5) * (n > 3 ? 0.18 : 0.06) // crowds scatter in depth too
        );
        node.rotation.y = rand() * Math.PI * 2;
        nodes.push(node);
        g.add(node);
      }
      // Small groups: two occupants turn to face each other. Loners and bigger
      // crowds just stand (walking/gesturing read unnatural at this scale and
      // clipped through walls).
      if (n >= 2 && n <= 3 && rand() < 0.5) {
        const cx = (rand() - 0.5) * 0.2;
        nodes[0].position.x = cx - 0.13;
        nodes[1].position.x = cx + 0.13;
        nodes[0].rotation.y = Math.PI / 2;
        nodes[1].rotation.y = -Math.PI / 2;
      }
      return g;
    },
  },
  {
    name: "shrine",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 1,
    radius: 0.25,
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
      g.userData.tick = flicker(lamp, 0.002);
      return g;
    },
  },
  {
    name: "beacon",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 2,
    radius: 0.1,
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
  {
    name: "awning",
    addedOn: "2026-06-11",
    mount: "wall",
    weight: 2,
    radius: 0.5,
    build(T, rand) {
      const g = new T.Group();
      const stripes = 2 + Math.floor(rand() * 3); // 2-4 slats
      const cols = [0xbb3b3b, 0xe6dccb]; // alternating dusty red / cream
      const ww = 0.6 + rand() * 0.35; // window-line width
      const sw = 0.16; // slat depth along the slope
      for (let i = 0; i < stripes; i++) {
        const slat = box(T, ww, 0.02, sw, cols[i % 2]);
        slat.position.set(0, 0.22 - i * sw * 0.5, 0.1 + i * sw * 0.85);
        slat.rotation.x = -0.6; // slope outward and down
        g.add(slat);
      }
      const strut = box(T, 0.03, 0.42, 0.03, 0x2a2226);
      strut.position.set(ww / 2 - 0.05, -0.05, 0.2);
      strut.rotation.x = 0.5;
      g.add(strut);
      return g;
    },
  },
  {
    name: "flag",
    addedOn: "2026-06-11",
    mount: "roof",
    weight: 2,
    radius: 0.15,
    build(T, rand) {
      const g = new T.Group();
      const ph = 0.7 + rand() * 0.6;
      const pole = box(T, 0.03, ph, 0.03, 0x55556a);
      pole.position.y = ph / 2;
      // `cloth` is a pivot at the pole top so the sway hinges on the pole.
      const cloth = new T.Group();
      cloth.userData.animated = true; // tick rotates it — keep out of the matrix freeze
      cloth.position.set(0.015, ph - 0.12, 0);
      const fw = 0.26 + rand() * 0.14;
      const col = rand() < 0.4 ? pickNeon(rand) : CLOTH[Math.floor(rand() * CLOTH.length)];
      const panel = new T.Mesh(new T.PlaneGeometry(fw, 0.18), lambert(T, col, { side: T.DoubleSide }));
      panel.position.x = fw / 2;
      cloth.add(panel);
      g.add(pole, cloth);
      const base = (rand() - 0.5) * 0.3;
      const speed = 1.5 + rand() * 1.5;
      const phase = rand() * Math.PI * 2;
      cloth.rotation.y = base;
      g.userData.tick = (t) => {
        cloth.rotation.y = base + Math.sin(t * speed + phase) * 0.25;
      };
      return g;
    },
  },
  {
    name: "cables",
    addedOn: "2026-06-11",
    mount: "wall",
    weight: 2,
    radius: 0.2,
    build(T, rand) {
      const g = new T.Group();
      const anchor = box(T, 0.07, 0.07, 0.04, 0x202028);
      g.add(anchor);
      const n = 2 + Math.floor(rand() * 2); // 2-3 cables
      for (let i = 0; i < n; i++) {
        const len = 0.7 + rand() * 0.5;
        const cable = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, len, 5), lambert(T, 0x1a1a22));
        cable.rotation.z = 0.85 + rand() * 0.5; // drape from vertical
        cable.position.set(0.08 + i * 0.04, -len * 0.32, 0.04 + rand() * 0.05);
        g.add(cable);
      }
      return g;
    },
  },
  {
    name: "crates",
    addedOn: "2026-06-11",
    mount: "ledge",
    weight: 2,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const cols = [0x6b4a2f, 0x7a5230, 0x3a5a6a, 0x6a6a55]; // wood / plastic
      const n = 2 + Math.floor(rand() * 3); // 2-4 boxes
      const crates = [];
      const sizes = [];
      let y = 0;
      for (let i = 0; i < n; i++) {
        const s = 0.15 + rand() * 0.1; // 0.15-0.25
        const crate = box(T, s, s, s, drift(cols[Math.floor(rand() * cols.length)], rand, 0.12));
        crate.position.set((rand() - 0.5) * 0.06, y + s / 2, (rand() - 0.5) * 0.06);
        crate.rotation.y = (rand() - 0.5) * 0.3;
        g.add(crate);
        crates.push(crate);
        sizes.push(s);
        y += s;
      }
      if (rand() < 0.4) {
        // One glowing shipping label on a random crate's front.
        const k = Math.floor(rand() * crates.length);
        const c = crates[k];
        const s = sizes[k];
        const label = glow(T, s * 0.5, s * 0.4, pickNeon(rand));
        label.position.set(c.position.x, c.position.y, c.position.z + s / 2 + 0.002);
        label.rotation.y = c.rotation.y;
        g.add(label);
      }
      return g;
    },
  },
  {
    name: "water-tank",
    addedOn: "2026-06-11",
    mount: "roof",
    weight: 2,
    radius: 0.35,
    build(T, rand) {
      const g = new T.Group();
      const rust = drift(0x6a4632, rand, 0.18);
      const r = 0.26 + rand() * 0.08;
      const bodyH = 0.34 + rand() * 0.18;
      const legH = 0.16 + rand() * 0.1;
      const tank = new T.Mesh(new T.CylinderGeometry(r, r, bodyH, 10), lambert(T, rust));
      tank.position.y = legH + bodyH / 2;
      const lid = new T.Mesh(new T.CylinderGeometry(r * 0.92, r, 0.05, 10), lambert(T, drift(0x55402e, rand, 0.15)));
      lid.position.y = legH + bodyH + 0.02;
      g.add(tank, lid);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = box(T, 0.05, legH, 0.05, 0x3a2e22);
        leg.position.set(sx * r * 0.62, legH / 2, sz * r * 0.62);
        g.add(leg);
      }
      if (rand() < 0.45) {
        // dripping rust streak down one side
        const streak = box(T, 0.05, bodyH * 0.8, 0.01, 0x2a3530);
        const a = rand() * Math.PI * 2;
        streak.position.set(Math.cos(a) * r, legH + bodyH * 0.4, Math.sin(a) * r);
        streak.rotation.y = -a;
        g.add(streak);
      }
      return g;
    },
  },
  {
    name: "exhaust-fan",
    addedOn: "2026-06-11",
    mount: "wall",
    weight: 2,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const shroud = box(T, 0.5, 0.5, 0.22, drift(0x3a3a44, rand, 0.12));
      const rim = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.06, 12), lambert(T, 0x2a2a32));
      rim.rotation.x = Math.PI / 2;
      rim.position.z = 0.13;
      // fan disc spun by the tick: blade boxes crossing a hub
      const fan = new T.Group();
      fan.userData.animated = true; // tick spins it — keep out of the matrix freeze
      fan.position.z = 0.16;
      const hub = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.05, 6), lambert(T, 0x55555f));
      hub.rotation.x = Math.PI / 2;
      fan.add(hub);
      const blades = 3 + Math.floor(rand() * 2); // 3-4 (6-8 spokes)
      for (let i = 0; i < blades; i++) {
        const blade = box(T, 0.04, 0.34, 0.01, 0x6a6a74);
        blade.rotation.z = (i / blades) * Math.PI;
        fan.add(blade);
      }
      const streak = box(T, 0.1, 0.55, 0.01, 0x262026);
      streak.position.set((rand() - 0.5) * 0.2, -0.5, 0.12);
      g.add(shroud, rim, fan, streak);
      const speed = 1.5 + rand() * 2.5;
      g.userData.tick = (t) => { fan.rotation.z = t * speed; };
      return g;
    },
  },
  {
    name: "vertical-sign",
    addedOn: "2026-06-11",
    mount: "wall",
    weight: 2,
    radius: 0.25,
    build(T, rand) {
      const g = new T.Group();
      const col = pickNeon(rand);
      const segs = 3 + Math.floor(rand() * 4); // 3-6
      const sw = 0.16 + rand() * 0.08;
      const sh = 0.16;
      const gap = 0.04;
      const total = segs * (sh + gap);
      const backing = box(T, sw + 0.06, total + 0.06, 0.05, 0x14141c);
      backing.position.y = total / 2;
      g.add(backing);
      const pick = Math.floor(rand() * segs);
      let flickerSeg = null;
      for (let i = 0; i < segs; i++) {
        const seg = glow(T, sw, sh, col);
        seg.position.set(0, sh / 2 + i * (sh + gap), 0.03);
        g.add(seg);
        if (i === pick) flickerSeg = seg;
      }
      g.userData.tick = flicker(flickerSeg, 0.02);
      return g;
    },
  },
  {
    name: "lantern-string",
    addedOn: "2026-06-11",
    mount: "wall",
    weight: 2,
    radius: 0.45,
    build(T, rand) {
      const g = new T.Group();
      const span = 1.0;
      const n = 3 + Math.floor(rand() * 4); // 3-6
      const warm = [0xffb300, 0xff5a3a, 0xff7aa8, 0xffd24a]; // amber / red / pink / gold
      const sag = 0.16 + rand() * 0.1;
      const pts = [];
      const lanterns = [];
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        const x = -span / 2 + f * span;
        const y = -sag * Math.sin(f * Math.PI); // dip in the middle
        pts.push([x, y]);
        const lant = glowBox(T, 0.07, 0.1, 0.07, warm[Math.floor(rand() * warm.length)]);
        lant.position.set(x, y - 0.05, 0.04);
        g.add(lant);
        lanterns.push(lant);
      }
      // thin sagging wire: a box per gap, tilted to follow the arc
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const wire = box(T, len, 0.01, 0.01, 0x33333a);
        wire.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0.02);
        wire.rotation.z = Math.atan2(y2 - y1, x2 - x1);
        g.add(wire);
      }
      g.userData.tick = flicker(lanterns[Math.floor(rand() * lanterns.length)], 0.015);
      return g;
    },
  },
  {
    name: "solar-rack",
    addedOn: "2026-06-11",
    mount: "roof",
    weight: 2,
    radius: 0.4,
    build(T, rand) {
      const g = new T.Group();
      const n = 2 + Math.floor(rand() * 3); // 2-4
      const tilt = -0.5 - rand() * 0.3;
      const pw = 0.5;
      const pd = 0.42;
      const blue = drift(0x1a2a5a, rand, 0.12);
      const pitch = pw + 0.06;
      for (let i = 0; i < n; i++) {
        const x = -((n - 1) * pitch) / 2 + i * pitch;
        const backLeg = box(T, 0.03, 0.3, 0.03, 0x44444f);
        backLeg.position.set(x, 0.15, -pd * 0.35);
        const frontLeg = box(T, 0.03, 0.12, 0.03, 0x44444f);
        frontLeg.position.set(x, 0.06, pd * 0.35);
        const panel = box(T, pw, 0.03, pd, blue);
        panel.position.set(x, 0.23, 0);
        panel.rotation.x = tilt;
        g.add(backLeg, frontLeg, panel);
      }
      return g;
    },
  },
  {
    name: "pigeon-coop",
    addedOn: "2026-06-11",
    mount: "roof",
    weight: 1,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const wood = drift(0x6a5236, rand, 0.15);
      const hutch = box(T, 0.4, 0.3, 0.3, wood);
      hutch.position.y = 0.15;
      const roof = box(T, 0.46, 0.05, 0.36, drift(0x4a3a28, rand, 0.12));
      roof.position.y = 0.32;
      g.add(hutch, roof);
      for (let i = 0; i < 4; i++) {
        const slat = box(T, 0.02, 0.22, 0.01, 0x3a2e20);
        slat.position.set(-0.14 + i * 0.09, 0.15, 0.151);
        g.add(slat);
      }
      // 1-3 tiny birds perched on the roof or on the deck nearby
      const birds = 1 + Math.floor(rand() * 3);
      const grey = [0x8a8a92, 0x6a6a74, 0x9a9088];
      for (let i = 0; i < birds; i++) {
        const onRoof = rand() < 0.6;
        const bird = box(T, 0.05, 0.05, 0.07, grey[Math.floor(rand() * grey.length)]);
        bird.position.set(
          (rand() - 0.5) * 0.36,
          onRoof ? 0.37 : 0.025,
          (rand() - 0.5) * 0.26 + (onRoof ? 0 : 0.28)
        );
        bird.rotation.y = rand() * Math.PI * 2;
        g.add(bird);
      }
      return g;
    },
  },
  {
    name: "kiosk",
    addedOn: "2026-06-11",
    mount: "ledge",
    weight: 2,
    radius: 0.4,
    build(T, rand) {
      const g = new T.Group();
      const body = box(T, 0.6, 0.55, 0.4, drift(0x3a3340, rand, 0.12));
      body.position.y = 0.275;
      const awning = box(T, 0.7, 0.04, 0.18, drift(0xa3473a, rand, 0.14));
      awning.position.set(0, 0.52, 0.26);
      awning.rotation.x = -0.4;
      const pane = glow(T, 0.46, 0.26, pickNeon(rand));
      pane.position.set(0, 0.34, 0.201);
      g.add(body, awning, pane);
      g.userData.tick = flicker(pane, 0.004);
      // stacked goods on the counter ledge
      const goods = [0x6b4a2f, 0x3a5a6a, 0x7a5230];
      const n = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const s = 0.1 + rand() * 0.05;
        const gb = box(T, s, s, s, drift(goods[Math.floor(rand() * goods.length)], rand, 0.12));
        gb.position.set(-0.18 + i * 0.16, 0.55 + s / 2, 0.12);
        gb.rotation.y = (rand() - 0.5) * 0.4;
        g.add(gb);
      }
      return g;
    },
  },
  {
    name: "barrels",
    addedOn: "2026-06-11",
    mount: "ledge",
    weight: 2,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const cols = [0x4a5a3a, 0x5a4632, 0x3a5a6a, 0x6a5a2a]; // olive / rust / steel-blue / mustard
      const n = 2 + Math.floor(rand() * 3); // 2-4
      const r = 0.12;
      const h = 0.34;
      const tipped = rand() < 0.4 ? Math.floor(rand() * n) : -1;
      for (let i = 0; i < n; i++) {
        const col = drift(cols[Math.floor(rand() * cols.length)], rand, 0.1);
        const drum = new T.Mesh(new T.CylinderGeometry(r, r, h, 10), lambert(T, col));
        const band = new T.Mesh(new T.CylinderGeometry(r + 0.01, r + 0.01, 0.03, 10), lambert(T, 0x2a2a30));
        const ang = (i / n) * Math.PI * 2;
        const px = Math.cos(ang) * 0.16;
        const pz = Math.sin(ang) * 0.16;
        if (i === tipped) {
          drum.rotation.x = Math.PI / 2;
          drum.position.set(px, r, pz);
          band.rotation.x = Math.PI / 2;
          band.position.set(px, r, pz);
        } else {
          drum.position.set(px, h / 2, pz);
          band.position.set(px, h * 0.7, pz);
        }
        g.add(drum, band);
      }
      return g;
    },
  },
  {
    name: "planter",
    addedOn: "2026-06-11",
    mount: "ledge",
    weight: 2,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const holo = rand() < 0.1; // rare neon-tinted "holo-plant" variant
      const bw = 0.5;
      const bd = 0.2;
      const planter = box(T, bw, 0.16, bd, drift(0x4a4036, rand, 0.12));
      planter.position.y = 0.08;
      const soil = box(T, bw - 0.04, 0.04, bd - 0.04, 0x241e18);
      soil.position.y = 0.16;
      g.add(planter, soil);
      const greens = [0x2e6a3a, 0x3a7a5a, 0x4a8a4a, 0x2a6a6a]; // green / teal
      const n = 2 + Math.floor(rand() * 3); // 2-4
      for (let i = 0; i < n; i++) {
        const x = -bw / 2 + 0.1 + (i / Math.max(n - 1, 1)) * (bw - 0.2);
        const fh = 0.16 + rand() * 0.16;
        const col = greens[Math.floor(rand() * greens.length)];
        const neon = pickNeon(rand);
        if (rand() < 0.5) {
          const leaf = holo ? glowBox(T, 0.1, fh, 0.08, neon) : box(T, 0.1, fh, 0.08, drift(col, rand, 0.15));
          leaf.position.set(x, 0.18 + fh / 2, (rand() - 0.5) * 0.06);
          leaf.rotation.z = (rand() - 0.5) * 0.3;
          g.add(leaf);
        } else {
          const rad = 0.08 + rand() * 0.04;
          const bush = holo
            ? new T.Mesh(new T.SphereGeometry(rad, 6, 5), new T.MeshBasicMaterial({ color: neon }))
            : new T.Mesh(new T.SphereGeometry(rad, 6, 5), lambert(T, drift(col, rand, 0.15)));
          bush.position.set(x, 0.2 + fh * 0.4, (rand() - 0.5) * 0.06);
          g.add(bush);
        }
      }
      return g;
    },
  },
  {
    name: "think-tank",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 1,
    radius: 0.3,
    build(T, rand) {
      return buildThinkTank(T, rand); // parked spider-tank on a deck
    },
  },
  {
    name: "surveillance-camera",
    addedOn: "2026-06-10",
    mount: "wall",
    weight: 2,
    radius: 0.25,
    build(T, rand) {
      const g = new T.Group();
      const mount = box(T, 0.06, 0.06, 0.12, 0x2a2a32);
      mount.position.z = 0.06;
      // head pans slowly around the outward (+z) axis
      const head = new T.Group();
      const body = box(T, 0.12, 0.1, 0.22, drift(0x3a3a44, rand, 0.12));
      body.position.z = 0.1;
      const lens = new T.Mesh(new T.SphereGeometry(0.035, 6, 6), new T.MeshBasicMaterial({ color: 0xff3b3b }));
      lens.position.z = 0.22;
      head.add(body, lens);
      head.position.z = 0.12;
      head.userData.animated = true; // tick pans it — keep out of the matrix freeze
      g.add(mount, head);
      const sp = 0.4 + rand() * 0.4;
      const ph = rand() * Math.PI * 2;
      const amp = 0.5 + rand() * 0.4;
      g.userData.tick = (t) => { head.rotation.y = Math.sin(t * sp + ph) * amp; };
      return g;
    },
  },
  {
    name: "server-rack",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 2,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const w = 0.4 + rand() * 0.2;
      const h = 0.6 + rand() * 0.4;
      const d = 0.3;
      const cab = box(T, w, h, d, drift(0x26262e, rand, 0.1));
      cab.position.y = h / 2;
      g.add(cab);
      const rows = 4 + Math.floor(rand() * 4);
      const leds = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 3; c++) {
          const led = glowBox(T, 0.03, 0.03, 0.01, pickNeon(rand));
          led.position.set(-w / 2 + 0.08 + c * 0.08, 0.08 + (r * (h - 0.12)) / rows, d / 2 + 0.006);
          g.add(led);
          leds.push(led);
        }
      }
      g.userData.tick = flicker(leds[Math.floor(rand() * leds.length)], 0.05);
      return g;
    },
  },
  {
    name: "holo-totem",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 2,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const ph = 0.9 + rand() * 0.6;
      const pole = box(T, 0.05, ph, 0.05, 0x33333a);
      pole.position.y = ph / 2;
      g.add(pole);
      const c = pickNeon(rand);
      const panel = new T.Mesh(
        new T.PlaneGeometry(0.4 + rand() * 0.2, 0.6 + rand() * 0.4),
        new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, side: T.DoubleSide })
      );
      panel.position.set(0, ph * 0.62, 0.05);
      g.add(panel);
      for (let i = 0; i < 3; i++) {
        const bar = glowBox(T, 0.18, 0.04, 0.005, c);
        bar.position.set((rand() - 0.5) * 0.1, ph * 0.62 + 0.18 - i * 0.16, 0.056);
        g.add(bar);
      }
      const sp = 1.5 + rand() * 2;
      const ph2 = rand() * Math.PI * 2;
      g.userData.tick = (t) => { panel.material.opacity = 0.35 + 0.25 * Math.sin(t * sp + ph2); };
      return g;
    },
  },
  {
    name: "cooling-tower",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 2,
    radius: 0.4,
    build(T, rand) {
      const g = new T.Group();
      const r = 0.3 + rand() * 0.1;
      const h = 0.4 + rand() * 0.2;
      const body = new T.Mesh(new T.CylinderGeometry(r, r * 1.05, h, 12), lambert(T, drift(0x3a3a42, rand, 0.1)));
      body.position.y = h / 2;
      const rim = new T.Mesh(new T.CylinderGeometry(r * 0.92, r * 0.92, 0.04, 12), lambert(T, 0x2a2a30));
      rim.position.y = h;
      g.add(body, rim);
      const fan = new T.Group();
      fan.position.y = h;
      fan.userData.animated = true; // tick spins it — keep out of the matrix freeze
      for (const a of [0, Math.PI / 2]) {
        const blade = box(T, r * 1.6, 0.02, 0.1, 0x55555f);
        blade.rotation.y = a;
        fan.add(blade);
      }
      g.add(fan);
      const sp = 0.6 + rand() * 1.2;
      g.userData.tick = (t) => { fan.rotation.y = t * sp; };
      return g;
    },
  },
  {
    name: "drone-pad",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 1,
    radius: 0.3,
    build(T, rand) {
      const g = new T.Group();
      const pad = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.03, 12), lambert(T, drift(0x2a2a32, rand, 0.1)));
      pad.position.y = 0.015;
      const mark = new T.Mesh(new T.RingGeometry(0.16, 0.2, 16), new T.MeshBasicMaterial({ color: 0xffb300, side: T.DoubleSide }));
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.032;
      g.add(pad, mark);
      // parked quadcopter
      const body = box(T, 0.14, 0.05, 0.14, 0x3a3a44);
      body.position.y = 0.09;
      g.add(body);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const rotor = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.008, 8), lambert(T, 0x55555f));
        rotor.position.set(sx * 0.11, 0.11, sz * 0.11);
        g.add(rotor);
      }
      const lamp = new T.Mesh(new T.SphereGeometry(0.02, 5, 5), new T.MeshBasicMaterial({ color: 0x00e5ff }));
      lamp.position.set(0, 0.13, 0);
      g.add(lamp);
      const phf = rand() * Math.PI * 2;
      g.userData.tick = (t) => { lamp.visible = Math.sin(t * 3 + phf) > -0.3; };
      return g;
    },
  },
  {
    name: "mech-frame",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 0.4,
    radius: 0.4,
    build(T, rand) {
      const g = new T.Group();
      const metal = drift(METAL[Math.floor(rand() * METAL.length)], rand, 0.1);
      const dark = 0x2a2a32;
      for (const sx of [-1, 1]) {
        const thigh = box(T, 0.07, 0.22, 0.08, metal);
        thigh.position.set(sx * 0.09, 0.28, 0);
        const shin = box(T, 0.06, 0.2, 0.07, dark);
        shin.position.set(sx * 0.11, 0.1, 0.02);
        const foot = box(T, 0.1, 0.04, 0.16, metal);
        foot.position.set(sx * 0.11, 0.02, 0.04);
        g.add(thigh, shin, foot);
      }
      const hips = box(T, 0.26, 0.1, 0.16, metal);
      hips.position.y = 0.42;
      const cage = box(T, 0.3, 0.34, 0.24, dark); // open cockpit cage
      cage.position.y = 0.62;
      const seat = glowBox(T, 0.14, 0.16, 0.02, pickNeon(rand)); // empty pilot glow
      seat.position.set(0, 0.62, 0.13);
      g.add(hips, cage, seat);
      for (const sx of [-1, 1]) {
        const upper = box(T, 0.07, 0.24, 0.08, metal); // hydraulic arm
        upper.position.set(sx * 0.2, 0.62, 0.02);
        upper.rotation.z = sx * 0.12;
        const claw = box(T, 0.1, 0.1, 0.12, dark);
        claw.position.set(sx * 0.24, 0.46, 0.04);
        g.add(upper, claw);
      }
      const head = box(T, 0.12, 0.1, 0.12, metal);
      head.position.y = 0.84;
      const eye = glowBox(T, 0.09, 0.03, 0.012, 0xff3b3b);
      eye.position.set(0, 0.85, 0.06);
      g.add(head, eye);
      return g;
    },
  },
  {
    name: "billboard-tower",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 1,
    radius: 0.5,
    build(T, rand) {
      const g = new T.Group();
      const ph = 1.0 + rand() * 0.8;
      for (const sx of [-1, 1]) {
        const leg = box(T, 0.05, ph, 0.05, 0x33333a);
        leg.position.set((sx * 0.44) / 2, ph / 2, 0);
        leg.rotation.z = sx * 0.08;
        g.add(leg);
      }
      const brace = box(T, 0.5, 0.04, 0.04, 0x44444f);
      brace.position.y = ph * 0.5;
      g.add(brace);
      const c = pickNeon(rand);
      const fw = 0.9 + rand() * 0.3;
      const fh = 0.6 + rand() * 0.3;
      const frame = box(T, fw, fh, 0.05, 0x14141c);
      frame.position.y = ph + 0.3;
      const screen = new T.Mesh(
        new T.PlaneGeometry(fw - 0.08, fh - 0.08),
        new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, side: T.DoubleSide })
      );
      screen.position.set(0, ph + 0.3, 0.03);
      g.add(frame, screen);
      for (let i = 0; i < 3; i++) {
        const bar = glowBox(T, fw * 0.6, 0.05, 0.005, c);
        bar.position.set((rand() - 0.5) * 0.1, ph + 0.3 + 0.16 - i * 0.16, 0.035);
        g.add(bar);
      }
      const sp = 1.2 + rand() * 1.5;
      const ph2 = rand() * Math.PI * 2;
      g.userData.tick = (t) => { screen.material.opacity = 0.4 + 0.2 * Math.sin(t * sp + ph2); };
      return g;
    },
  },
  {
    name: "smokestack",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 2,
    radius: 0.25,
    build(T, rand) {
      const g = new T.Group();
      const r = 0.12 + rand() * 0.06;
      const h = 0.8 + rand() * 0.7;
      const stack = new T.Mesh(new T.CylinderGeometry(r * 0.85, r, h, 9), lambert(T, drift(0x3a352f, rand, 0.12)));
      stack.position.y = h / 2;
      const cap = new T.Mesh(new T.CylinderGeometry(r * 1.1, r * 1.1, 0.06, 9), lambert(T, 0x2a2a30));
      cap.position.y = h;
      g.add(stack, cap);
      const band = glowBox(T, r * 0.4, 0.12, 0.01, 0xff7a1a); // glowing vent slit
      band.position.set(r * 0.86, h * 0.78, 0);
      g.add(band);
      for (const ya of [0.35, 0.62]) {
        const strap = new T.Mesh(new T.CylinderGeometry(r * 1.02, r * 1.02, 0.03, 9), lambert(T, 0x26262c));
        strap.position.y = h * ya;
        g.add(strap);
      }
      return g;
    },
  },
  {
    name: "cargo-container",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 2,
    radius: 0.45,
    build(T, rand) {
      const g = new T.Group();
      const cols = [0x3a5a6a, 0x6a4632, 0x4a5a3a, 0x6a3a3a, 0x5a5a3a];
      const w = 0.8 + rand() * 0.5;
      const h = 0.34 + rand() * 0.1;
      const d = 0.4;
      const body = box(T, w, h, d, drift(cols[Math.floor(rand() * cols.length)], rand, 0.12));
      body.position.y = h / 2;
      g.add(body);
      const ribs = Math.floor(w / 0.12); // corrugation grooves
      for (let i = 0; i < ribs; i++) {
        const rib = box(T, 0.015, h * 0.86, 0.01, 0x101014);
        rib.position.set(-w / 2 + 0.06 + i * 0.12, h / 2, d / 2 + 0.003);
        g.add(rib);
      }
      const door = box(T, 0.02, h * 0.9, d * 0.9, 0x1c1c22);
      door.position.set(w / 2 + 0.003, h / 2, 0);
      g.add(door);
      if (rand() < 0.6) {
        const label = glow(T, 0.18, 0.1, pickNeon(rand));
        label.position.set(-w / 2 + 0.2, h * 0.6, d / 2 + 0.004);
        g.add(label);
      }
      if (rand() < 0.4) {
        const top = box(T, w * 0.8, h, d, drift(cols[Math.floor(rand() * cols.length)], rand, 0.12));
        top.position.set((rand() - 0.5) * 0.2, h * 1.5, (rand() - 0.5) * 0.1);
        top.rotation.y = (rand() - 0.5) * 0.3;
        g.add(top);
      }
      return g;
    },
  },
  {
    name: "transformer",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 1,
    radius: 0.35,
    build(T, rand) {
      const g = new T.Group();
      const body = box(T, 0.5, 0.34, 0.34, drift(0x44474d, rand, 0.1));
      body.position.y = 0.17;
      const fins = box(T, 0.04, 0.3, 0.36, 0x2a2a30);
      fins.position.set(-0.27, 0.17, 0);
      g.add(body, fins);
      for (let i = 0; i < 3; i++) {
        const ins = new T.Mesh(new T.CylinderGeometry(0.03, 0.04, 0.18, 7), lambert(T, 0x9a9a86));
        ins.position.set(-0.16 + i * 0.16, 0.43, 0.08);
        const cap = new T.Mesh(new T.SphereGeometry(0.022, 5, 5), new T.MeshBasicMaterial({ color: 0x9adfff }));
        cap.position.set(-0.16 + i * 0.16, 0.53, 0.08);
        g.add(ins, cap);
      }
      const stripe = glowBox(T, 0.2, 0.05, 0.012, 0xffb300); // hazard glow, buzzing
      stripe.position.set(0.1, 0.2, 0.18);
      g.add(stripe);
      g.userData.tick = flicker(stripe, 0.03);
      return g;
    },
  },
  {
    name: "tarp-shelter",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 2,
    radius: 0.45,
    build(T, rand) {
      const g = new T.Group();
      const tcol = [0x5a4632, 0x3a5a6a, 0x6a3a3a, 0x4a4a52][Math.floor(rand() * 4)];
      const w = 0.6 + rand() * 0.4;
      const dd = 0.5 + rand() * 0.3;
      const ph = 0.4 + rand() * 0.2;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tall = sz < 0 ? ph : ph * 0.6; // slope the tarp down the back
        const pole = box(T, 0.03, tall, 0.03, 0x33282a);
        pole.position.set(sx * w * 0.45, tall / 2, sz * dd * 0.45);
        g.add(pole);
      }
      const tarp = box(T, w * 1.1, 0.02, dd * 1.2, drift(tcol, rand, 0.14));
      tarp.position.set(0, ph * 0.85, 0);
      tarp.rotation.x = 0.35;
      const crate = box(T, 0.18, 0.18, 0.18, drift(0x6a5230, rand, 0.12));
      crate.position.set(-w * 0.2, 0.09, 0);
      const lamp = glow(T, 0.06, 0.08, 0xffb300);
      lamp.position.set(w * 0.2, ph * 0.5, dd * 0.3);
      g.add(tarp, crate, lamp);
      g.userData.tick = flicker(lamp, 0.004);
      return g;
    },
  },
  {
    name: "torii-gate",
    addedOn: "2026-06-10",
    mount: "roof",
    weight: 1,
    radius: 0.35,
    build(T, rand) {
      const g = new T.Group();
      const col = rand() < 0.5 ? 0xaa3344 : 0x14141c;
      const h = 0.5 + rand() * 0.3;
      const span = 0.5 + rand() * 0.2;
      for (const sx of [-1, 1]) {
        const post = box(T, 0.05, h, 0.05, drift(col, rand, 0.1));
        post.position.set((sx * span) / 2, h / 2, 0);
        g.add(post);
      }
      const top = box(T, span + 0.18, 0.06, 0.08, drift(col, rand, 0.1));
      top.position.y = h;
      const lintel = box(T, span + 0.02, 0.04, 0.06, drift(col, rand, 0.1));
      lintel.position.y = h - 0.12;
      const neon = glowBox(T, span, 0.02, 0.01, pickNeon(rand));
      neon.position.set(0, h - 0.15, 0.04);
      g.add(top, lintel, neon);
      return g;
    },
  },
  {
    name: "holo-koi",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 1,
    radius: 0.35,
    build(T, rand) {
      const g = new T.Group();
      const base = box(T, 0.16, 0.08, 0.16, drift(0x2a2a32, rand, 0.1));
      base.position.y = 0.04;
      const emitter = glow(T, 0.08, 0.08, 0x9adfff);
      emitter.rotation.x = -Math.PI / 2;
      emitter.position.y = 0.085;
      g.add(base, emitter);
      const c = rand() < 0.5 ? 0xff7aa8 : 0x9adfff;
      const koi = new T.Group(); // holographic fish circling the projector
      const body = glowBox(T, 0.16, 0.05, 0.07, c);
      const tail = glowBox(T, 0.07, 0.04, 0.05, c);
      tail.position.x = -0.11;
      koi.add(body, tail);
      koi.userData.animated = true; // tick orbits it — keep out of the matrix freeze
      g.add(koi);
      const rad = 0.16 + rand() * 0.06;
      const yc = 0.3 + rand() * 0.1;
      const sp = 0.6 + rand() * 0.6;
      const ph = rand() * Math.PI * 2;
      g.userData.tick = (t) => {
        const a = t * sp + ph;
        koi.position.set(Math.cos(a) * rad, yc + Math.sin(a * 2) * 0.05, Math.sin(a) * rad);
        koi.rotation.y = -a + Math.PI / 2; // nose into the turn
      };
      return g;
    },
  },
];
