// Fan speed maths shared by the room-card slide and its tests.

export const clampPercent = (v: number) => Math.min(100, Math.max(0, v));

// Snap a 0–100 value to the nearest multiple of a fan's percentage_step.
export const snapPercent = (v: number, step: number) => clampPercent(Math.round(v / step) * step);

// The integer percentage to send to fan.set_percentage for a snapped value.
// Round down: HA maps a percentage to speed ceil(pct * speeds / 100), so 16.67
// rounded up to 17 would land on speed 2 (and 66.67 -> 67 on 5). Floor gives
// 16/33/50/66/83/100, the same values HA reports per speed.
export const percentToSend = (v: number) => Math.floor(v + 1e-6);

// Number of speeds a fan has, and which one a percentage is (0 = off).
export const speedCount = (step: number) => Math.round(100 / step);
export const speedOf = (pct: number, step: number) => Math.round(pct / step);
