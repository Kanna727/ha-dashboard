// Back to the Home page after the screen has been left alone (the owner asked
// on 2026-10-26: Home is the wall tablet's glance page). Pure, for tests;
// layout/IdleHome.tsx applies it.
export interface IdleInput {
  page: string;
  idleMs: number;
  minutes: number; // 0 turns it off
  modalOpen: boolean;
  busy: boolean; // a sheet is open or cards are being arranged: someone is mid-task
  vacuumRunning: boolean; // the Clean page stays while the robot runs (it opens by itself then)
}

// `close`: close the open popup; `home`: go to the Home page.
export function idleHomeStep(i: IdleInput): { close: boolean; home: boolean } {
  const none = { close: false, home: false };
  if (i.minutes <= 0 || i.idleMs < i.minutes * 60_000 || i.busy) return none;
  const stay = i.page === 'home' || (i.page === 'clean' && i.vacuumRunning);
  return { close: i.modalOpen, home: !stay };
}
