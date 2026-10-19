import { useEffect, useState } from 'react';
import { useHass } from '../ha/api';
import { useEntity } from '../ha/store';
import { domainOf, isOn, isUnavailable, stateLabel } from '../ha/format';
import { useLongPress } from '../hooks/useLongPress';
import { Icon, type IconName } from './Icon';
import { FanIcon } from './FanIcon';
import { LightIcon } from './LightIcon';
import { lightRgb } from '../lib/lightColor';
import { useOpenSheet } from './Sheet';
import type { ControlDef } from '../config/entities';

const DEFAULT_ICON: Record<string, IconName> = { light: 'light', fan: 'fan', switch: 'switch' };

export function EntityTile({ entity, name, icon, readOnly, confirmOff }: ControlDef) {
  const hass = useHass();
  const openSheet = useOpenSheet();
  const e = useEntity(entity);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const domain = domainOf(entity);
  const on = isOn(e);
  const offline = isUnavailable(e);
  const iconName = (icon as IconName | undefined) ?? DEFAULT_ICON[domain] ?? 'switch';
  const asking = confirming && on;

  // The "Turn off?" prompt lapses after 4 s, like the leaving-home button.
  useEffect(() => {
    if (!asking) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [asking]);

  const toggle = () => {
    if (readOnly || offline) return;
    if (confirmOff && on && !asking) return setConfirming(true);
    setConfirming(false);
    setPending(true);
    hass
      .callService(domain, 'toggle', {}, { entity_id: entity })
      .finally(() => window.setTimeout(() => setPending(false), 400));
  };

  const press = useLongPress(toggle, domain === 'light' || domain === 'fan' ? () => openSheet({ entity, name }) : undefined);

  return (
    <button
      className={`tile ${domain} ${on ? 'on' : ''} ${offline ? 'offline' : ''} ${pending ? 'pending' : ''} ${readOnly ? 'readonly' : ''} ${asking ? 'confirm' : ''}`}
      {...press}
      aria-pressed={on}
      aria-label={asking ? `Tap again to turn off ${name}` : `${name}: ${stateLabel(e)}`}
    >
      <span className="tile-icon">
        {iconName === 'fan' ? (
          <FanIcon on={on} pct={e?.attributes.percentage as number | undefined} size={22} />
        ) : iconName === 'light' ? (
          <LightIcon on={on} brightness={((e?.attributes.brightness as number | undefined) ?? 255) / 255} color={lightRgb(e)} size={22} />
        ) : (
          <Icon name={iconName} size={22} />
        )}
      </span>
      <span className="tile-name">{name}</span>
      <span className="tile-state">{asking ? 'Turn off?' : stateLabel(e)}</span>
    </button>
  );
}
