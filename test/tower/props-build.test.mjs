import test from "node:test";
import assert from "node:assert/strict";
import { PROPS } from "../../assets/js/tower/props.js";

// Minimal stub of the THREE namespace covering exactly what the props use.
// Geometry/material classes just record their arguments; no rendering.

class Vec3 {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

class Group {
  constructor() {
    this.children = [];
    this.position = new Vec3();
    this.rotation = new Vec3();
    this.userData = {};
  }
  add(...objects) {
    this.children.push(...objects);
    return this;
  }
}

class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new Vec3();
    this.rotation = new Vec3();
    this.visible = true;
  }
}

class Geometry {
  constructor(...args) {
    this.args = args;
  }
}

class Material {
  constructor(options = {}) {
    Object.assign(this, options);
  }
}

const T = {
  Group,
  Mesh,
  BoxGeometry: class extends Geometry {},
  PlaneGeometry: class extends Geometry {},
  CylinderGeometry: class extends Geometry {},
  SphereGeometry: class extends Geometry {},
  MeshLambertMaterial: class extends Material {},
  MeshBasicMaterial: class extends Material {},
  DoubleSide: 2,
};

// Tiny seeded LCG: deterministic build-time rand, per the prop contract.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

for (const prop of PROPS) {
  test(`${prop.name} builds without frame-time RNG and ticks cleanly`, () => {
    const realRandom = Math.random;
    let group;
    try {
      // Build-time: Math.random must never run (RNG boundary).
      Math.random = () => {
        throw new Error(`${prop.name} called Math.random() during build`);
      };
      group = prop.build(T, lcg(0xc0ffee));
    } finally {
      Math.random = realRandom;
    }

    assert.ok(group, prop.name);
    assert.ok(group.userData, prop.name);

    // Frame-time: ticks may use Math.random (now restored) but must not throw.
    if (group.userData.tick) {
      assert.doesNotThrow(() => {
        group.userData.tick(0);
        group.userData.tick(1.5);
      }, prop.name);
    }
  });
}
