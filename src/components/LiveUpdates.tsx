import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { store } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { freshUpdates, posted, readNotification, removed, type LiveUpdate } from '../lib/liveUpdates';
import { Icon } from './Icon';

const REMOVED = '_removed_notification';

// Every Android phone's "Last notification" sensors, found by name.
function useNotificationSensors(): HassEntity[] {
  const cache = useRef<HassEntity[]>([]);
  return useSyncExternalStore(store.subscribe, () => {
    const all = store.getAll();
    const next = Object.keys(all)
      .filter((id) => id.endsWith('_notification') && /^sensor\..+_last(_removed)?_notification$/.test(id))
      .sort()
      .map((id) => all[id]);
    const prev = cache.current;
    if (prev.length === next.length && prev.every((e, i) => e === next[i])) return prev;
    cache.current = next;
    return next;
  });
}

function useLiveUpdates(): LiveUpdate[] {
  const sensors = useNotificationSensors();
  const [list, setList] = useState<LiveUpdate[]>([]);
  useEffect(() => {
    setList((l) => {
      const added = sensors.filter((s) => !s.entity_id.endsWith(REMOVED)).reduce((acc, s) => posted(acc, readNotification(s)), l);
      return sensors.filter((s) => s.entity_id.endsWith(REMOVED)).reduce((acc, s) => removed(acc, readNotification(s)), added);
    });
  }, [sensors]);
  const now = useNow(60_000).getTime();
  return freshUpdates(list, now);
}

// The app's logo, or its first letter on its colour when there's none or it won't load.
function AppLogo({ u }: { u: LiveUpdate }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="live-logo" style={{ background: u.color }}>
      {u.logo && !failed ? <img src={u.logo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : u.app[0]}
    </span>
  );
}

function Island({ u }: { u: LiveUpdate }) {
  return (
    <section className="live-island" aria-label={`${u.app}: ${u.title}`}>
      <AppLogo u={u} />
      <span className="live-island-text">
        <strong>{u.title}</strong>
        {u.text && <span>{u.text}</span>}
      </span>
      {u.percent !== undefined && (
        <>
          <span className="live-route">
            <i className="live-route-done" style={{ width: `${u.percent}%` }} />
            <span className={`live-route-rider ${u.delivery ? '' : 'plain'}`} style={{ left: `${u.percent}%` }}>
              {u.delivery && <Icon name="moped" size={18} />}
            </span>
            {u.delivery && (
              <span className="live-route-home">
                <Icon name="home" size={16} />
              </span>
            )}
          </span>
          <span className="live-update-percent">{u.percent}%</span>
        </>
      )}
    </section>
  );
}

// Live Updates from apps on the phones (a delivery on its way): one island per
// app, floating above the tab bar on every page, so the page doesn't move. Taps
// pass through to the page.
export function LiveUpdates() {
  const updates = useLiveUpdates();
  if (!updates.length) return null;
  return (
    <div className="live-islands">
      {updates.map((u) => (
        <Island key={u.key} u={u} />
      ))}
    </div>
  );
}
