import { useState } from 'react';
import { commuteMock, updateCommuteMock, type Traffic } from './commute';

// Commute test panel (preview builds, like the car test panel): the mock's
// traffic, a route error and the commute window. Only the fake routes change.
export function CommuteTestPanel() {
  const [open, setOpen] = useState(new URLSearchParams(window.location.search).has('commuteTest'));
  const [, redraw] = useState(0);
  const set = (p: Partial<typeof commuteMock>) => {
    updateCommuteMock(p);
    redraw((n) => n + 1);
  };

  if (!open) {
    return (
      <button className="car-test car-test-chip commute-test" onClick={() => setOpen(true)}>
        Commute test
      </button>
    );
  }
  return (
    <div className="car-test" role="group" aria-label="Commute test">
      <div className="sky-test-head">
        <strong>Commute test</strong>
        <button onClick={() => setOpen(false)} aria-label="Minimise">
          –
        </button>
      </div>
      <div className="car-test-body">
        <div className="car-test-group">
          <div className="car-test-title">Traffic</div>
          <div className="car-test-chips">
            {(['light', 'moderate', 'heavy'] as Traffic[]).map((t) => (
              <button key={t} className={`chip-btn small ${commuteMock.traffic === t ? 'active' : ''}`} onClick={() => set({ traffic: t })}>
                {t}
              </button>
            ))}
            <button className={`chip-btn small ${commuteMock.error ? 'armed' : ''}`} onClick={() => set({ error: !commuteMock.error })}>
              Route error
            </button>
          </div>
        </div>
        <div className="car-test-group">
          <div className="car-test-title">Commute window</div>
          <div className="car-test-chips">
            {([[null, 'Follow clock'], [true, 'Open'], [false, 'Closed']] as const).map(([v, label]) => (
              <button key={label} className={`chip-btn small ${commuteMock.window === v ? 'active' : ''}`} onClick={() => set({ window: v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
