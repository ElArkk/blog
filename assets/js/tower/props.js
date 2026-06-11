// Hand-built low-poly prop library for the Moontower renderer.
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

export const NEON = [0xff2d78, 0x00e5ff, 0x9d4dff, 0x00ff9c, 0xffb300];

// Muted clothing palette: greys, browns, navy, dark green, dusty red.
const CLOTH = [0x4a4a52, 0x3a3a42, 0x5a4632, 0x6a5238, 0x2a2e44, 0x2e3a2c, 0x6a3a3a];

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
      const body = box(T, 0.32, 0.6, 0.3, 0x28283a);
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
      g.userData.tick = flicker(lantern, 0.003);
      return g;
    },
  },
  {
    name: "people",
    addedOn: "2026-06-10",
    mount: "ledge",
    weight: 4,
    radius: 0.45,
    build(T, rand) {
      const g = new T.Group();
      // Dim skin-ish head tones (seeded variation): reads dark at distance.
      const SKIN = [0x6a5a50, 0x5e4f46, 0x74604f, 0x55483f, 0x6f5a4a];
      const n = 2 + Math.floor(rand() * 4); // 2-5 figures
      const figures = [];
      for (let i = 0; i < n; i++) {
        const person = new T.Group();
        const tall = 0.2 + rand() * 0.1; // 0.20-0.30 body height (head extra)
        const broad = rand() < 0.4;
        const w = broad ? 0.09 + rand() * 0.03 : 0.06 + rand() * 0.02;
        const d = broad ? 0.06 : 0.045;
        const coat = CLOTH[Math.floor(rand() * CLOTH.length)];
        const skin = SKIN[Math.floor(rand() * SKIN.length)];
        const sitting = rand() < 0.3;

        // Vertical budget: legs -> hip -> torso -> head, sitting drops it all.
        const legH = tall * (sitting ? 0.4 : 0.45);
        const hipH = tall * 0.12;
        const torsoH = tall * (sitting ? 0.5 : 0.48);
        const headS = w * 0.72;
        const hipY = sitting ? tall * 0.18 + hipH / 2 : legH + hipH / 2;
        const torsoBase = hipY + hipH / 2;
        const shoulderY = torsoBase + torsoH * 0.85;
        const headY = torsoBase + torsoH + headS * 0.5;
        const headTop = headY + headS * 0.5;

        // Two separate legs with seeded stance; bent forward when seated.
        const legW = w * 0.42;
        const legL = box(T, legW, legH, d * 0.9, coat);
        const legR = box(T, legW, legH, d * 0.9, coat);
        if (sitting) {
          // Seated figures sit on a stool, so they ground anywhere on a deck
          // (the old dangling-over-the-edge pose floated mid-air).
          const stoolH = tall * 0.18;
          const stool = box(T, w * 1.15, stoolH, d * 1.3, 0x4a3a30);
          stool.position.y = stoolH / 2;
          person.add(stool);
          for (const [leg, sx] of [[legL, -1], [legR, 1]]) {
            leg.position.set(sx * w * 0.22, stoolH * 0.55, d * 0.55 + legH * 0.28);
            leg.rotation.x = -0.95 + (rand() - 0.5) * 0.15; // slope down to the deck
          }
        } else {
          legL.position.set(-w * 0.22, legH / 2, 0);
          legR.position.set(w * 0.22, legH / 2, 0);
          legL.rotation.z = (rand() - 0.5) * 0.18;
          legR.rotation.z = (rand() - 0.5) * 0.18;
        }

        const hip = box(T, w, hipH, d, coat);
        hip.position.y = hipY;
        const torso = box(T, w, torsoH, d, coat);
        torso.position.y = torsoBase + torsoH / 2;
        const head = box(T, headS, headS, headS, skin);
        head.position.y = headY;
        person.add(legL, legR, hip, torso, head);

        // Two arms on shoulder pivots. Poses are picked for silhouette
        // legibility at 320px: hanging, one arm straight out, one raised.
        const armW = Math.max(0.025, w * 0.28);
        const armLen = torsoH * 0.92;
        const hasPhone = rand() < 0.15;
        const pose = hasPhone ? 2 : rand() < 0.55 ? 0 : rand() < 0.45 ? 1 : 2;
        for (const sx of [-1, 1]) {
          const pivot = new T.Group();
          const arm = box(T, armW, armLen, armW, coat);
          arm.position.y = -armLen / 2; // hang down from the shoulder pivot
          pivot.add(arm);
          pivot.position.set(sx * (w / 2 + armW * 0.4), shoulderY, 0);
          if (pose === 1 && sx > 0) {
            pivot.rotation.z = 1.5; // arm straight out to the side
          } else if (pose === 2 && sx > 0) {
            pivot.rotation.z = 2.55; // arm raised (holds the phone if any)
          } else {
            pivot.rotation.z = sx * -0.08; // hanging with a slight flare
          }
          person.add(pivot);
        }

        if (rand() < 0.2) {
          // Neon accent: jacket panel or a held item.
          const accent = glowBox(T, w * 0.5, torsoH * 0.35, d * 0.6, pickNeon(rand));
          accent.position.set(w * 0.3, torsoBase + torsoH * (0.4 + rand() * 0.4), d * 0.45);
          person.add(accent);
        }

        // ~40% hat or hood, clothing-coloured (silhouette stays dark).
        if (rand() < 0.4) {
          let hat;
          if (rand() < 0.5) {
            hat = box(T, headS * 1.25, headS * 0.45, headS * 1.25, coat);
            hat.position.y = headY + headS * 0.4;
          } else {
            hat = new T.Mesh(new T.CylinderGeometry(headS * 0.55, headS * 0.7, headS * 0.6, 6), lambert(T, coat));
            hat.position.y = headY + headS * 0.2;
          }
          person.add(hat);
        }

        // Glowing phone in the raised hand — pale cyan, lights the face.
        if (hasPhone) {
          const phone = glowBox(T, 0.035, 0.05, 0.01, 0x9fefff);
          phone.position.set(w / 2 + armW + 0.03, headY, d * 0.25);
          person.add(phone);
        }

        // ~10% umbrella: thin shaft + cone canopy (dark or dusty red).
        if (rand() < 0.1) {
          const ucol = rand() < 0.5 ? 0x2a2a30 : 0x8a3a3a;
          const top = headTop + 0.12;
          const base = shoulderY * 0.4;
          const shaftH = top - base;
          const shaft = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, shaftH, 6), lambert(T, 0x33333a));
          shaft.position.set(w * 0.6, base + shaftH / 2, d * 0.3);
          const canopy = new T.Mesh(new T.CylinderGeometry(0.001, 0.16, 0.07, 6), lambert(T, ucol));
          canopy.position.set(w * 0.6, top, d * 0.3);
          person.add(shaft, canopy);
        }

        if (!sitting) person.rotation.z = (rand() - 0.5) * 0.1; // subtle standing lean
        person.position.x = -0.3 + i * 0.2 + rand() * 0.08;
        person.rotation.y = rand() * Math.PI * 2;
        figures.push(person);
        g.add(person);
      }
      // Conversation: two figures turn to face each other ~0.25 apart.
      if (n >= 2 && rand() < 0.5) {
        const cx = -0.1 + rand() * 0.2;
        figures[0].position.x = cx - 0.125;
        figures[1].position.x = cx + 0.125;
        figures[0].rotation.y = Math.PI / 2;
        figures[1].rotation.y = -Math.PI / 2;
      }
      // Rare walker: one figure paces a short seeded path (all captured here).
      if (rand() < 0.15) {
        const walker = figures[Math.floor(rand() * figures.length)];
        walker.userData.animated = true; // tick moves it — keep out of the matrix freeze
        const startX = walker.position.x;
        const span = 0.3 + rand() * 0.2; // ±0.3-0.5 endpoints
        const speed = 0.25 + rand() * 0.5;
        const faceY = walker.rotation.y;
        g.userData.tick = (t) => {
          const phase = t * speed - Math.floor(t * speed);
          const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4; // [-1,1]
          walker.position.x = startX + tri * span;
          walker.rotation.y = phase < 0.5 ? faceY : faceY + Math.PI; // flip at turn
        };
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
        const crate = box(T, s, s, s, cols[Math.floor(rand() * cols.length)]);
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
];
