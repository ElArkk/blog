import test from "node:test";
import assert from "node:assert/strict";
import { computeStats, demoDays, mulberry32 } from "../../days/stats.js";

test("points sum all completed objectives", () => {
  const days = [{ d: 3, t: 3 }, { d: 1, t: 4 }, null, { d: 0, t: 4 }];
  assert.equal(computeStats(days).points, 4);
});

test("streak counts consecutive perfect days, miss resets", () => {
  const days = [{ d: 3, t: 3 }, { d: 4, t: 4 }, { d: 0, t: 4 },
                { d: 4, t: 4 }, { d: 4, t: 4 }];
  const s = computeStats(days);
  assert.equal(s.streak, 2);
  assert.equal(s.best, 2);
});

test("paused days do not break the streak", () => {
  assert.equal(computeStats([{ d: 3, t: 3 }, null, { d: 4, t: 4 }]).streak, 2);
});

test("closed partial resets, trailing open today does not", () => {
  assert.equal(computeStats([{ d: 3, t: 3 }, { d: 1, t: 3 }, { d: 3, t: 3 }]).streak, 1);
  assert.equal(computeStats([{ d: 3, t: 3 }, { d: 3, t: 3 }, { d: 1, t: 3 }]).streak, 2);
});

test("empty-goal day (0/0) is not perfect", () => {
  assert.equal(computeStats([{ d: 0, t: 0 }, { d: 0, t: 0 }]).streak, 0);
});

test("empty input", () => {
  assert.deepEqual(computeStats([]), { points: 0, streak: 0, best: 0 });
});

test("mulberry32 is deterministic", () => {
  const a = mulberry32(7), b = mulberry32(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("demoDays shape: t grows, d never exceeds t", () => {
  const days = demoDays(120, 1);
  assert.equal(days.length, 120);
  for (const day of days) {
    if (day === null) continue;
    assert.ok(day.t >= 3 && day.t <= 5);
    assert.ok(day.d >= 0 && day.d <= day.t);
  }
});
