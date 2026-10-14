import { useEffect, useState } from 'react';
import { useHass } from '../ha/api';
import { store } from '../ha/store';
import { recoverEntities } from '../panels/useOfflineDevices';
import { Icon } from './Icon';
import { offlineLabel, type ConsumerPower } from './useHomePower';

type Phase = 'idle' | 'confirm' | 'running' | 'done' | 'failed';

// "Oven, Washer offline · total excludes them   [Reload]". The button brings
// every offline plug back the way the status dialog would (restart button,
// Matter Server restart, or a config-entry reload), after a second tap within 4 s.
// `compact` (the narrow panel) drops the "total excludes them" suffix so the
// names stay readable next to the button; it stays in the tooltip.
export function OfflinePlugsNote({ offline, hasTotal, compact }: { offline: ConsumerPower[]; hasTotal: boolean; compact?: boolean }) {
  const hass = useHass();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (phase !== 'confirm' && phase !== 'done' && phase !== 'failed') return;
    const id = window.setTimeout(() => setPhase('idle'), phase === 'confirm' ? 4000 : 6000);
    return () => window.clearTimeout(id);
  }, [phase]);

  if (!offline.length) return null;
  const names = offline.map((c) => c.name);

  const onClick = () => {
    if (phase === 'running') return;
    if (phase !== 'confirm') return setPhase('confirm');
    setPhase('running');
    recoverEntities(hass, offline.map((c) => c.entity), store.getAll())
      .then(() => setPhase('done'))
      .catch((e) => {
        setError(String(e?.message ?? e));
        setPhase('failed');
      });
  };

  const label =
    phase === 'confirm' ? (offline.length > 1 ? `Reload ${offline.length}?` : 'Reload?')
    : phase === 'running' ? 'Reloading…'
    : phase === 'done' ? 'Requested'
    : phase === 'failed' ? 'Failed'
    : 'Reload';

  return (
    <div className="ef-offline">
      <Icon name="wifiOff" size={14} />
      <span className="ef-offline-text" title={`${names.join(', ')} offline${hasTotal ? '; the total excludes them' : ''}`}>
        {offlineLabel(names)}{hasTotal && !compact ? ' · total excludes them' : ''}
      </span>
      <button
        className={`ef-reload ${phase}`}
        onClick={onClick}
        title={phase === 'failed' ? error : `Reload ${names.join(', ')}`}
        aria-label={`Reload offline plugs: ${names.join(', ')}`}
      >
        <Icon name={phase === 'done' ? 'tick' : phase === 'failed' ? 'alert' : 'refresh'} size={14} />
        {label}
      </button>
    </div>
  );
}
