// Dishwasher card art: how dirty the dishes look during a cycle, and when the
// "clean dishes" shine after a cycle shows. Pure, unit-tested.

export const SHINE_MINUTES = 5;

// Each smudge fades out over the FADE % of progress before its `gone` mark,
// so the dishes come clean bit by bit rather than all at once.
const FADE = 25;
export const smudgeOpacity = (gone: number, pct: number) => Math.min(1, Math.max(0, (gone - pct) / FADE));

// The overall grime film: full at the start of a cycle, gone at the end.
export const grimeOpacity = (pct: number) => 0.3 * Math.min(1, Math.max(0, 1 - pct / 100));

// When the cycle finished (epoch ms), if the live states say so. Home Connect
// reports operation state "finished" and progress 100 for about a minute; then
// the state goes to "ready", progress to 0 and both soon to unavailable, so
// the caller has to remember the time itself.
export function finishedAt(opState?: string, opChanged?: string, progress?: number, progressChanged?: string): number | undefined {
  const t = opState === 'finished' ? Date.parse(opChanged ?? '') : progress === 100 ? Date.parse(progressChanged ?? '') : NaN;
  return Number.isFinite(t) ? t : undefined;
}

// Shine for SHINE_MINUTES after the finish, unless a new cycle is running.
// A minute of slack before the finish covers the tablet's clock running behind HA's.
export function shineEnds(doneAt: number | undefined, now: number, running: boolean): number | undefined {
  if (running || doneAt === undefined) return undefined;
  const end = doneAt + SHINE_MINUTES * 60_000;
  return now >= doneAt - 60_000 && now < end ? end : undefined;
}
