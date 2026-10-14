import { useEffect, useState } from 'react';
import { useHass } from '../ha/api';
import { relTime } from '../ha/format';
import { Icon } from '../components/Icon';
import { useIssues } from './useIssues';
import { runRecovery, useOfflineDevices, type OfflineDevice } from './useOfflineDevices';

type Phase = 'idle' | 'confirm' | 'running' | 'done' | 'failed';

function RecoverButton({ device }: { device: OfflineDevice }) {
  const hass = useHass();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();

  // Confirm and result states fall back to idle on their own.
  useEffect(() => {
    if (phase !== 'confirm' && phase !== 'done' && phase !== 'failed') return;
    const id = window.setTimeout(() => setPhase('idle'), phase === 'confirm' ? 4000 : 6000);
    return () => window.clearTimeout(id);
  }, [phase]);

  const onClick = () => {
    if (phase === 'running') return;
    if (phase !== 'confirm') return setPhase('confirm');
    setPhase('running');
    runRecovery(hass, device)
      .then(() => setPhase('done'))
      .catch((e) => {
        setError(String(e?.message ?? e));
        setPhase('failed');
      });
  };

  const label =
    phase === 'confirm' ? `Tap again to ${device.recovery.label.toLowerCase()}`
    : phase === 'running' ? 'Working…'
    : phase === 'done' ? 'Requested'
    : phase === 'failed' ? 'Failed'
    : device.recovery.label;

  return (
    <button
      className={`recover-btn ${phase}`}
      onClick={onClick}
      title={phase === 'failed' ? error : undefined}
      aria-label={`${device.recovery.label}: ${device.name}`}
    >
      <Icon name={phase === 'done' ? 'tick' : phase === 'failed' ? 'alert' : 'refresh'} size={16} />
      {label}
    </button>
  );
}

export function StatusDialog() {
  const issues = useIssues().filter((i) => i.id !== 'offline');
  const { devices, error, refresh } = useOfflineDevices();

  useEffect(() => {
    refresh(); // pick up devices added since the last registry fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="status-dialog">
      {issues.length > 0 && (
        <ul className="issue-list">
          {issues.map((i) => (
            <li key={i.id} className={i.severity}>
              <span className="dot" /> {i.text}
            </li>
          ))}
        </ul>
      )}

      <div className="status-section">
        <div className="panel-head">
          <h2 className="label">Offline devices</h2>
          <span className="panel-summary">{devices.length ? `${devices.length} unavailable` : 'None'}</span>
        </div>
        {error && <p className="muted small">Couldn't read the device list: {error}</p>}
        {!error && devices.length === 0 && (
          <div className="all-good"><Icon name="check" size={22} /> Every device is reporting.</div>
        )}
        <ul className="offline-list">
          {devices.map((d) => (
            <li key={d.id}>
              <span className="offline-icon"><Icon name="wifiOff" size={20} /></span>
              <div className="offline-text">
                <div className="offline-name">{d.name}</div>
                <div className="muted small">
                  {[d.area, d.integration, d.since ? `offline ${relTime(d.since).replace(' ago', '')}` : undefined].filter(Boolean).join(' · ')}
                </div>
                {d.hint && <div className="offline-hint small">{d.hint}</div>}
              </div>
              <RecoverButton device={d} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
