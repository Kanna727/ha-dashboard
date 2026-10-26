import { useSyncExternalStore } from 'react';
import { APPLIANCES } from '../config/entities';
import { DishwasherDetail } from '../components/DishwasherModal';
import { GlanceBar, GlanceTile } from '../components/GlanceTile';
import { Icon } from '../components/Icon';
import { isUnavailable, num } from '../ha/format';
import { useEntity } from '../ha/store';
import { vacuumStatus } from '../lib/vacuum';
import { useVacuumId } from '../vacuum/useVacuum';
import { VacuumPage } from '../vacuum/VacuumPage';

// The Clean page (#clean): the robot vacuum and the dishwasher, each full size,
// with a switch at the top that shows both of their states. The vacuum's page
// was its own page before the tabs; it opens on the vacuum when the robot
// starts a run (vacuum/useAutoOpen.ts) or its chip or pill is tapped.
type View = 'vacuum' | 'dishwasher';

let view: View = 'vacuum';
const listeners = new Set<() => void>();
export function showOnClean(v: View) {
  if (v === view) return;
  view = v;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// Whether the page has anything to show (the tab is left out otherwise).
export function useHasClean(): boolean {
  const dw = useEntity(APPLIANCES.dishwasher.state || undefined);
  return !!useVacuumId() || !!dw;
}

export function CleanPage() {
  const vacId = useVacuumId();
  const vac = useEntity(vacId || undefined);
  const dwState = useEntity(APPLIANCES.dishwasher.state || undefined);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress || undefined);
  const current = useSyncExternalStore(subscribe, () => view);
  const both = !!vacId && !!dwState;
  const shown: View = !vacId ? 'dishwasher' : !dwState ? 'vacuum' : current;

  const v = vacuumStatus(vac?.state, vac?.attributes);
  const pct = num(dwProgress);
  const dwRunning = pct !== undefined && pct > 0 && pct < 100;
  const dwText = dwRunning ? `Running · ${Math.round(pct!)}%` : isUnavailable(dwState) ? 'Asleep' : 'Idle';

  const tabs: { id: View; label: string; icon: 'vacuum' | 'dishwasher'; status: string; tone: string }[] = [
    { id: 'vacuum', label: 'Vacuum', icon: 'vacuum', status: v.label, tone: v.tone },
    { id: 'dishwasher', label: 'Dishwasher', icon: 'dishwasher', status: dwText, tone: dwRunning ? 'active' : 'idle' },
  ];

  return (
    <div className="clean-page">
      {both && (
        <div className="clean-switch" role="tablist" aria-label="Clean">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={shown === t.id} className={`clean-tab tone-${t.tone} ${shown === t.id ? 'active' : ''}`} onClick={() => showOnClean(t.id)}>
              <Icon name={t.icon} size={22} />
              <span className="clean-tab-text">
                <b>{t.label}</b>
                <small>{t.status}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {shown === 'vacuum' ? (
        <VacuumPage />
      ) : (
        <section className="panel clean-dw">
          <DishwasherDetail />
        </section>
      )}
    </div>
  );
}

// Home page tile (GlancePanel): a bar each for the vacuum (its battery as the
// fill, lit while it runs) and the dishwasher (its progress as the fill), like
// the room chips.
export function CleanTile() {
  const vacId = useVacuumId();
  const base = vacId.split('.')[1] ?? '';
  const vac = useEntity(vacId || undefined);
  const vacBattery = useEntity(vacId ? `sensor.${base}_battery_level` : undefined);
  const dwState = useEntity(APPLIANCES.dishwasher.state || undefined);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress || undefined);
  if (!vacId && !dwState) return null;
  const v = vacuumStatus(vac?.state, vac?.attributes);
  const a = (vac?.attributes ?? {}) as Record<string, unknown>;
  const battery = num(vacBattery) ?? (typeof a.battery === 'number' ? a.battery : (a.battery_level as number | undefined));
  const pct = num(dwProgress);
  const dwRunning = pct !== undefined && pct > 0 && pct < 100;
  const vacOn = v.tone === 'active';
  return (
    <GlanceTile
      icon="broom"
      label="Cleaning"
      page="clean"
      onOpen={() => showOnClean(dwRunning && !vacOn ? 'dishwasher' : 'vacuum')}
      color="#2dd4bf"
      className="clean-tile"
      tone={v.tone === 'warn' ? 'warn' : undefined}
      foot={
        <span className="glance-bars">
          {vacId && <GlanceBar icon="vacuum" label={vacOn ? v.label : battery !== undefined ? `${Math.round(battery)}%` : v.label} level={battery} color="#2dd4bf" active={vacOn} />}
          {dwState && (
            <GlanceBar icon="dishwasher" label={dwRunning ? `${Math.round(pct!)}%` : isUnavailable(dwState) ? 'Asleep' : 'Idle'} level={dwRunning ? pct : 0} color="#2dd4bf" active={dwRunning} />
          )}
        </span>
      }
    />
  );
}
