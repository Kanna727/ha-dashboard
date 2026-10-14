import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useHass } from '../ha/api';
import { useEntity } from '../ha/store';
import { domainOf, isOn, stateLabel } from '../ha/format';
import { Icon } from './Icon';

interface SheetState {
  entity: string;
  name: string;
}

const SheetContext = createContext<(s: SheetState) => void>(() => undefined);
export const useOpenSheet = () => useContext(SheetContext);

// Long-press detail sheet: brightness for lights, speed for fans.
export function SheetProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const open = useCallback((s: SheetState) => setSheet(s), []);
  return (
    <SheetContext.Provider value={open}>
      {children}
      {sheet && <EntitySheet {...sheet} onClose={() => setSheet(null)} />}
    </SheetContext.Provider>
  );
}

function EntitySheet({ entity, name, onClose }: SheetState & { onClose: () => void }) {
  const hass = useHass();
  const e = useEntity(entity);
  const domain = domainOf(entity);
  const on = isOn(e);

  const current =
    domain === 'light'
      ? on ? Math.round(((e?.attributes.brightness as number) ?? 255) / 2.55) : 0
      : on ? Math.round((e?.attributes.percentage as number) ?? 100) : 0;
  const step = domain === 'fan' ? ((e?.attributes.percentage_step as number) ?? 1) : 1;
  const [value, setValue] = useState(current);

  useEffect(() => setValue(current), [current]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commit = (v: number) => {
    const target = { entity_id: entity };
    if (v <= 0) return hass.callService(domain, 'turn_off', {}, target);
    if (domain === 'light') return hass.callService('light', 'turn_on', { brightness_pct: v }, target);
    return hass.callService('fan', 'set_percentage', { percentage: v }, target);
  };

  const supportsLevel =
    domain === 'fan' || (domain === 'light' && (e?.attributes.supported_color_modes as string[] | undefined)?.some((m) => m !== 'onoff'));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label={name}>
        <header>
          <div>
            <h3>{name}</h3>
            <span className="muted">{stateLabel(e)}</span>
          </div>
          <button className={`round ${on ? 'active' : ''}`} onClick={() => hass.callService(domain, 'toggle', {}, { entity_id: entity })}>
            <Icon name="power" />
          </button>
        </header>
        {supportsLevel ? (
          <div className="level">
            <div className="level-track" style={{ ['--pct' as string]: `${value}%` }}>
              <input
                type="range"
                min={0}
                max={100}
                step={step}
                value={value}
                onChange={(ev) => setValue(Number(ev.target.value))}
                onPointerUp={() => commit(value)}
                onKeyUp={() => commit(value)}
                aria-label={domain === 'light' ? 'Brightness' : 'Speed'}
              />
            </div>
            <div className="level-value">{value}%</div>
          </div>
        ) : (
          <p className="muted">No level control for this device.</p>
        )}
        <button className="ghost wide" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
