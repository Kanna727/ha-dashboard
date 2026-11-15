// XIRR: the yearly rate that makes a list of dated cash flows add up to nothing
// (money in negative, money out positive, the current value counted as money
// out today), the same definition as the spreadsheet function: each flow is
// discounted by (1 + r) ^ (days since the first / 365).
//
// The rate is found by bracketing sign changes of the net present value on a
// grid of rates and bisecting each, so it never diverges the way a bare Newton
// step can, and returns undefined when there is no answer (all money in, or all
// flows on one day). When there are several answers (flows that change sign more
// than once) it takes the one nearest 10 %.
export interface Flow {
  t: number; // epoch ms
  amount: number; // money in negative, money out positive
}

const YEAR_MS = 365 * 86_400_000;

function npv(flows: Flow[], t0: number, rate: number): number {
  let s = 0;
  for (const f of flows) s += f.amount / Math.pow(1 + rate, (f.t - t0) / YEAR_MS);
  return s;
}

// Rates tried when looking for a sign change, from nearly -100 % to far above anything real.
const GRID = [-0.999, -0.99, -0.95, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, -0.05, 0, 0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 25, 100, 1000];

export function xirr(flows: Flow[]): number | undefined {
  const fs = flows.filter((f) => Number.isFinite(f.amount) && Number.isFinite(f.t) && f.amount !== 0).sort((a, b) => a.t - b.t);
  if (fs.length < 2 || !fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return undefined;
  const t0 = fs[0].t;
  if (fs[fs.length - 1].t === t0) return undefined;

  const roots: number[] = [];
  let prevR = GRID[0];
  let prevV = npv(fs, t0, prevR);
  if (prevV === 0) roots.push(prevR);
  for (let i = 1; i < GRID.length; i++) {
    const r = GRID[i];
    const v = npv(fs, t0, r);
    if (v === 0) roots.push(r);
    else if (prevV !== 0 && Math.sign(prevV) !== Math.sign(v)) {
      let lo = prevR;
      let hi = r;
      let vlo = prevV;
      for (let k = 0; k < 90; k++) {
        const mid = (lo + hi) / 2;
        const vm = npv(fs, t0, mid);
        if (vm === 0) {
          lo = hi = mid;
          break;
        }
        if (Math.sign(vm) === Math.sign(vlo)) {
          lo = mid;
          vlo = vm;
        } else hi = mid;
      }
      roots.push((lo + hi) / 2);
    }
    prevR = r;
    prevV = v;
  }
  if (!roots.length) return undefined;
  return roots.reduce((best, r) => (Math.abs(r - 0.1) < Math.abs(best - 0.1) ? r : best));
}
