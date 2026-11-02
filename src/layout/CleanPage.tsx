import { useSyncExternalStore } from 'react';
import { APPLIANCES } from '../config/entities';
import { DishwasherDetail } from '../components/DishwasherModal';
import { GlanceBar, GlanceTile } from '../components/GlanceTile';
import { Icon, type IconName } from '../components/Icon';
import { PurifierPage, purifierTabStatus } from '../components/PurifierPage';
import { usePurifier } from '../components/usePurifier';
import { isUnavailable, num } from '../ha/format';
import { useEntity } from '../ha/store';
import { vacuumStatus } from '../lib/vacuum';
import { useVacuumId } from '../vacuum/useVacuum';
import { VacuumPage } from '../vacuum/VacuumPage';

// The Clean page (#clean): the robot vacuum, the dishwasher and the water
// purifier, each full size, with a switch at the top that shows their states.
// The vacuum's page was its own page before the tabs; it opens on the vacuum
// when the robot starts a run (vacuum/useAutoOpen.ts) or its chip is tapped.
type View = 'vacuum' | 'dishwasher' | 'water';

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
  const water = useEntity(APPLIANCES.purifier?.tankTds);
  return !!useVacuumId() || !!dw || !!water;
}

export function CleanPage() {
  const vacId = useVacuumId();
  const vac = useEntity(vacId || undefined);
  const dwState = useEntity(APPLIANCES.dishwasher.state || undefined);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress || undefined);
  const purifier = usePurifier();
  const current = useSyncExternalStore(subscribe, () => view);
  const has: Record<View, boolean> = { vacuum: !!vacId, dishwasher: !!dwState, water: !!purifier.tank };
  const shown: View = has[current] ? current : (['vacuum', 'dishwasher', 'water'] as View[]).find((t) => has[t]) ?? 'vacuum';

  const v = vacuumStatus(vac?.state, vac?.attributes);
  const pct = num(dwProgress);
  const dwRunning = pct !== undefined && pct > 0 && pct < 100;
  const dwText = dwRunning ? `Running · ${Math.round(pct!)}%` : isUnavailable(dwState) ? 'Asleep' : 'Idle';

  const water = purifierTabStatus(purifier);
  const tabs = (
    [
      { id: 'vacuum', label: 'Vacuum', icon: 'vacuum', status: v.label, tone: v.tone },
      { id: 'dishwasher', label: 'Dishwasher', icon: 'dishwasher', status: dwText, tone: dwRunning ? 'active' : 'idle' },
      { id: 'water', label: 'Water', icon: 'water', status: water.text, tone: water.tone },
    ] as { id: View; label: string; icon: IconName; status: string; tone: string }[]
  ).filter((t) => has[t.id]);

  return (
    <div className="clean-page">
      {tabs.length > 1 && (
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
      ) : shown === 'water' ? (
        <PurifierPage />
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
