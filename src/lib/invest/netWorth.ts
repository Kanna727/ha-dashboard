// A cleaner net-worth line. The money app's history has glitches (one day shows a
// loss of several lakh, then the next day it is back), because an account is
// briefly missing from a day's total. A real change of level stays; a spike
// that comes straight back is replaced by a straight line between the days
// either side, and reported so the chart can say what it did.
export interface Pt {
  t: number;
  v: number;
}

export interface Cleaned {
  points: Pt[];
  // What was replaced: the day, what the app said, and what is shown instead.
  removed: { t: number; v: number; shown: number }[];
}

export interface CleanOptions {
  // Days either side that define the "normal" level for a day.
  window?: number;
  // How many robust deviations (MAD) away counts as odd.
  k?: number;
  // And at least this fraction of the level, so a quiet series doesn't flag small moves.
  minJump?: number;
  // A glitch lasts at most this many days.
  maxRun?: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function cleanSeries(input: Pt[], o: CleanOptions = {}): Cleaned {
  const w = o.window ?? 5;
  const k = o.k ?? 6;
  const minJump = o.minJump ?? 0.06;
  const maxRun = o.maxRun ?? 3;
  const pts = [...input].filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const n = pts.length;
  if (n < 2 * w + 1) return { points: pts, removed: [] };

  // Which days stand far from the ones around them.
  const odd = pts.map((p, i) => {
    const around = pts.slice(Math.max(0, i - w), Math.min(n, i + w + 1)).map((x) => x.v);
    const med = median(around);
    const mad = median(around.map((x) => Math.abs(x - med))) * 1.4826;
    const dev = Math.abs(p.v - med);
    return dev > k * mad && dev > minJump * Math.max(Math.abs(med), 1);
  });

  const removed: Cleaned['removed'] = [];
  const out = pts.map((p) => ({ ...p }));
  for (let i = 0; i < n; ) {
    if (!odd[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && odd[j]) j++; // the run is i .. j-1
    const before = i - 1;
    const after = j;
    // Only a run with a good day on both sides can be told from a change of level.
    if (before >= 0 && after < n && j - i <= maxRun) {
      const level = (pts[before].v + pts[after].v) / 2;
      const spike = pts.slice(i, j).reduce((s, p) => s + p.v, 0) / (j - i) - level;
      // It must come back: the days either side are close together compared with the spike.
      if (Math.abs(pts[after].v - pts[before].v) < 0.5 * Math.abs(spike)) {
        for (let x = i; x < j; x++) {
          const f = (pts[x].t - pts[before].t) / (pts[after].t - pts[before].t);
          const shown = Math.round(pts[before].v + (pts[after].v - pts[before].v) * f);
          removed.push({ t: pts[x].t, v: pts[x].v, shown });
          out[x].v = shown;
        }
      }
    }
    i = j;
  }
  return { points: out, removed };
}
