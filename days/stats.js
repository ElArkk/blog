// Pure Days stats + demo data. No DOM — node-testable.
// Mirrors stats() in modal-obsidian/src/tower.py: keep the two in sync.

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// points = sum of completed objectives (4/4 banks more than 3/3).
// streak/best count consecutive perfect days (d === t, t > 0); paused (null)
// days skip; the trailing day (today, still open) extends the streak when
// perfect but never breaks it.
export function computeStats(days) {
  let points = 0, streak = 0, best = 0;
  days.forEach((day, i) => {
    if (day == null) return;
    points += day.d;
    if (day.t > 0 && day.d === day.t) {
      streak += 1;
      best = Math.max(best, streak);
    } else if (i < days.length - 1) {
      streak = 0;
    }
  });
  return { points, streak, best };
}

// Deterministic synthetic history for ?demo=N development mode.
// t grows 3 -> 4 -> 5 across the span to exercise the volume rendering.
export function demoDays(n, seed = 1) {
  const rand = mulberry32(seed);
  const days = [];
  for (let i = 0; i < n; i++) {
    const t = i < n / 3 ? 3 : i < (2 * n) / 3 ? 4 : 5;
    const r = rand();
    if (r < 0.6) days.push({ d: t, t });
    else if (r < 0.78) days.push({ d: Math.max(1, Math.floor(rand() * t)), t });
    else if (r < 0.88) days.push({ d: 0, t });
    else days.push(null);
  }
  return days;
}
