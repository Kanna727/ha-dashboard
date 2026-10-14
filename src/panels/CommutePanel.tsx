import { useCallback, useEffect, useState } from 'react';
import { CommuteMap, commuteMissingText, useCommuteConfig } from '../commute/CommuteCard';
import { computeRoutes, inCommuteWindow, type CommuteConfig } from '../commute/routes';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { useNow } from '../hooks/useNow';

const REFRESH_MS = 2 * 60_000;

// ETA summary without loading the Maps JS; the full map opens in a modal.
// Auto-refresh only runs in the commute window to keep Routes API usage low.
function Summary({ config }: { config: CommuteConfig }) {
  const modal = useModal();
  const now = useNow(30_000);
  const [eta, setEta] = useState<{ seconds: number; meters: number; at: number } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setBusy(true);
    computeRoutes({ apiKey: config.apiKey, origin: config.origin, dest: config.dest, mode: config.defaultVehicle, alternatives: false })
      .then((r) => {
        setEta({ seconds: r[0].seconds, meters: r[0].meters, at: Date.now() });
        setError(undefined);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [config]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => inCommuteWindow() && refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const mins = eta ? Math.round(eta.seconds / 60) : undefined;
  const heavy = mins !== undefined && mins >= config.alertThresholdMin;
  const inWindow = inCommuteWindow(now);
  const vehicle = config.defaultVehicle === 'TWO_WHEELER' ? '🏍️' : '🚗';
  const open = () =>
    modal.open({ title: 'Commute', icon: 'navigate', accent: 'var(--accent)', wide: true, body: <CommuteMap config={config} mapHeight={460} /> });

  return (
    <section className="panel commute-panel">
      <PanelHead
        label="Commute"
        summary={heavy && inWindow ? 'Heavy traffic' : config.title}
        summaryClass={heavy && inWindow ? 'warn' : ''}
        onMore={open}
      />
      <div className="commute-summary" role="button" tabIndex={0} onClick={open}>
        <div className="commute-eta-big">
          {mins !== undefined ? mins : '–'}
          <small>min</small>
        </div>
        <div className="commute-meta">
          <div>{vehicle} {eta ? `${(eta.meters / 1000).toFixed(1)} km in current traffic` : error ? 'Route unavailable' : 'Checking traffic…'}</div>
          <div className="muted small">{error ? error : eta ? `As of ${new Date(eta.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}</div>
        </div>
        <button
          className={`round small ${busy ? 'pending' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            refresh();
          }}
          aria-label="Refresh commute"
        >
          <Icon name="refresh" size={18} />
        </button>
      </div>
    </section>
  );
}

export function CommutePanel() {
  const { config, error } = useCommuteConfig();
  if (config) return <Summary config={config} />;
  return (
    <section className="panel commute-panel">
      <PanelHead label="Commute" />
      <p className="muted small">{commuteMissingText(config, error)}</p>
    </section>
  );
}
