// Pure Tower state replay. No Three.js imports — node-testable.

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Replays the day string like a stack: P pushes a level carrying its day
// index, M pops the top (the level below gets a scar entry), a miss with
// nothing built adds rubble. Z (paused) and - (pending) are no-ops.
export function replay(results) {
  const levels = [];
  let rubble = 0;
  for (let day = 0; day < results.length; day++) {
    const ch = results[day];
    if (ch === "P") {
      levels.push({ day, scars: [] });
    } else if (ch === "M") {
      if (levels.length === 0) rubble++;
      else {
        levels.pop();
        if (levels.length > 0) levels[levels.length - 1].scars.push(day);
      }
    }
  }
  return { levels, rubble, height: levels.length };
}

// Deterministic synthetic history for ?demo=N development mode.
export function demoResults(n, seed = 1) {
  const rand = mulberry32(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const r = rand();
    out += r < 0.72 ? "P" : r < 0.92 ? "M" : "Z";
  }
  return out;
}

export function dateOfDay(startIso, dayIndex) {
  const d = new Date(startIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}
