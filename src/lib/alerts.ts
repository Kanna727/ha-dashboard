// Decisions behind the "done" and "door left open" banners. Pure, unit-tested.

// A cycle ended when we saw it running and now it isn't. Unknown (first
// reading after load) never counts, so a reload doesn't announce old news.
export const cycleEnded = (wasRunning: boolean | undefined, running: boolean) => wasRunning === true && !running;

export interface DoorReading {
  id: string;
  open: boolean;
  since: number; // epoch ms of the last state change
}

// Doors open for at least `minutes`, as keys `${id}@${since}`, so each open
// episode alerts once (closing and reopening is a new episode).
export function overdueDoors(doors: DoorReading[], now: number, minutes: number, alerted: Set<string>): { id: string; key: string; openMin: number }[] {
  return doors
    .filter((d) => d.open && Number.isFinite(d.since) && now - d.since >= minutes * 60_000)
    .map((d) => ({ id: d.id, key: `${d.id}@${d.since}`, openMin: Math.floor((now - d.since) / 60_000) }))
    .filter((d) => !alerted.has(d.key));
}
