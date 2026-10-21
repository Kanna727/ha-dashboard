import { useEntities } from '../ha/store';
import { num } from '../ha/format';
import { Icon } from '../components/Icon';
import { usePage } from '../layout/pages';
import { chipStatus } from '../lib/vacuum';
import { useVacuumId } from './useVacuum';

// The vacuum's chip on a room card (RoomDef.appliances 'vacuum'): its battery
// while it rests, where it is while it cleans, "Docking", "Paused" or a fault.
// A tap opens the vacuum page.
export function VacuumChip() {
  const id = useVacuumId();
  const base = id.split('.')[1] ?? '';
  const [vac, battery, room, area] = useEntities(id ? [id, `sensor.${base}_battery_level`, `sensor.${base}_current_room`, `sensor.${base}_cleaned_area`] : []);
  const [, go] = usePage();
  if (!id) return null;
  const a = (vac?.attributes ?? {}) as Record<string, unknown>;
  const pct = num(battery) ?? (typeof a.battery === 'number' ? a.battery : (a.battery_level as number | undefined));
  const where = room && room.state !== 'unavailable' && room.state !== 'unknown' ? room.state : undefined;
  const s = chipStatus(vac?.state, a, { battery: pct, room: where, area: num(area) });
  return (
    <button
      className={`row-btn vacuum ${s.on ? 'on' : ''} tone-${s.tone} ${s.short ? 'labelled' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        go('vacuum');
      }}
      aria-label={`${s.long}. Open the vacuum page`}
      title={s.long}
    >
      <Icon name="vacuum" size={22} className={vac?.state === 'cleaning' ? 'roam' : undefined} />
      {s.short && <span className="row-btn-label">{s.short}</span>}
    </button>
  );
}
