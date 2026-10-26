import { useEntity } from '../ha/store';
import { Icon } from '../components/Icon';
import { showOnClean } from '../layout/CleanPage';
import { usePage } from '../layout/pages';
import { vacuumStatus } from '../lib/vacuum';
import { useVacuumId } from './useVacuum';

// Top-bar button to the vacuum (on the Clean page). An icon while the robot rests;
// it spells out what the robot is doing while it runs or needs help.
export function VacuumPill() {
  const id = useVacuumId();
  const e = useEntity(id || undefined);
  const [page, go] = usePage();
  // On the Clean page the tab bar is the way back.
  if (!id || page === 'clean') return null;
  const s = vacuumStatus(e?.state, e?.attributes);
  const busy = s.tone === 'active' || s.tone === 'warn';
  const label = `Vacuum: ${s.label}`;
  return (
    <button
      className={`pill vac-pill ${busy ? '' : 'icon-pill'} tone-${s.tone}`}
      onClick={() => {
        showOnClean('vacuum');
        go('clean');
      }}
      aria-label={label}
      title={label}
    >
      <Icon name="vacuum" size={22} />
      {busy && <span className="pill-hint ellipsis">{s.label}</span>}
    </button>
  );
}
