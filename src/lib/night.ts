// Night-mode decisions. Pure, unit-tested.

export interface NightInput {
  enabled: boolean;
  layoutAllowed: boolean;
  idleMs: number; // time since the last touch / key / wheel
  idleMinutes: number;
  nightOnly: boolean;
  sunDown: boolean;
}

export const nightActive = (n: NightInput) =>
  n.enabled && n.layoutAllowed && n.idleMs >= n.idleMinutes * 60_000 && (!n.nightOnly || n.sunDown);

// Burn-in protection: a small offset that changes every minute, the same for a
// given minute (deterministic), within ±range px.
export function driftAt(minute: number, range = 24): { x: number; y: number } {
  const r = (n: number) => {
    const s = Math.sin(n * 12.9898 + minute * 78.233) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  return { x: Math.round(r(1) * range), y: Math.round(r(2) * range) };
}
