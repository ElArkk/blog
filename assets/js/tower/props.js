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
