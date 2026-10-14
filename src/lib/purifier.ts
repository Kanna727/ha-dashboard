// Water purifier readings (APPLIANCES.purifier), kept free of React so they
// can be unit-tested.

export interface PurifierInput {
  tankTds?: number; // ppm of the purified water
  inputTds?: number; // ppm of the incoming water
  mode?: string; // purification mode, e.g. "TasteTune 50-100 ppm"
  faults: { name: string; on: boolean }[];
}

export interface PurifierSummary {
  removedPct?: number; // share of dissolved solids taken out, 0-100
  target?: { min: number; max: number };
  inRange?: 'low' | 'ok' | 'high';
  activeFaults: string[];
  text: string; // short status for the room card
}

// "TasteTune 50-100 ppm" -> { min: 50, max: 100 }. Modes without a range
// (RO only, Adaptive, Vacation) give undefined.
export function targetRange(mode: string | undefined): { min: number; max: number } | undefined {
  const m = mode?.match(/(\d+)\s*[-–]\s*(\d+)\s*ppm/i);
  if (!m) return undefined;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return min < max ? { min, max } : undefined;
}

// Left edge for the TDS chart: the first reading when the recorder holds less
// than the window (a newly added purifier), so the line isn't a sliver at the
// right edge. Undefined means "use the full window".
export function chartStart(points: { t: number }[], hours: number, now: number): number | undefined {
  const windowStart = now - hours * 3600_000;
  const first = points[0]?.t;
  return first !== undefined && first > windowStart + 3600_000 ? Math.min(first, now - 60_000) : undefined;
}

export function purifierSummary({ tankTds, inputTds, mode, faults }: PurifierInput): PurifierSummary {
  const removedPct =
    tankTds !== undefined && inputTds !== undefined && inputTds > 0
      ? Math.round(Math.min(100, Math.max(0, (1 - tankTds / inputTds) * 100)))
      : undefined;
  const target = targetRange(mode);
  const inRange =
    target && tankTds !== undefined ? (tankTds < target.min ? 'low' : tankTds > target.max ? 'high' : 'ok') : undefined;
  const activeFaults = faults.filter((f) => f.on).map((f) => f.name);
  const text = activeFaults.length
    ? `Purifier: ${activeFaults[0]}${activeFaults.length > 1 ? ` +${activeFaults.length - 1}` : ''}`
    : tankTds !== undefined
      ? `Water ${Math.round(tankTds)} ppm`
      : 'Purifier';
  return { removedPct, target, inRange, activeFaults, text };
}
