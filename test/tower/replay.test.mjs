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
