import { useEntity } from '../ha/store';
import { Icon } from '../components/Icon';
import { usePage } from '../layout/pages';
import { vacuumStatus } from '../lib/vacuum';
import { useVacuumId } from './useVacuum';

// Top-bar button to the vacuum page (and back). An icon while the robot rests;
// it spells out what the robot is doing while it runs or needs help.
export function VacuumPill() {
  const id = useVacuumId();
  const e = useEntity(id || undefined);
  const [page, go] = usePage();
  if (!id) return null;
  const s = vacuumStatus(e?.state, e?.attributes);
  const here = page === 'vacuum';
  const busy = s.tone === 'active' || s.tone === 'warn';
  const label = here ? 'Back to the dashboard' : `Vacuum: ${s.label}`;
  return (
    <button
      className={`pill vac-pill ${busy ? '' : 'icon-pill'} tone-${s.tone} ${here ? 'here' : ''}`}
      onClick={() => go(here ? 'home' : 'vacuum')}
      aria-label={label}
      aria-pressed={here}
      title={label}
    >
      <Icon name={here ? 'home' : 'vacuum'} size={22} />
      {busy && !here && <span className="pill-hint ellipsis">{s.label}</span>}
    </button>
  );
}
