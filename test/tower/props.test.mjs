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
    assert.ok(p.radius > 0, p.name);
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
