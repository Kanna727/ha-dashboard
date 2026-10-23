import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { chime, siren } from '../lib/chime';
import { isResolved, type DismissWhen } from '../lib/alerts';
import { store } from '../ha/store';

export interface Toast {
  id: string;
  title: string;
  text?: string;
  icon: IconName;
  // 'alarm' (full-screen only): red, jumps the queue, a siren, up until tapped.
  tone?: 'ok' | 'warn' | 'alarm';
  // Full-screen alert (Alerts.tsx) instead of a corner banner.
  full?: boolean;
  emoji?: string; // shown big in place of the icon (full-screen only)
  source?: string; // "Home Assistant" for mirrored notifications
  seconds?: number; // full-screen lifetime, default 30 (alarms have none)
  dismissWhen?: DismissWhen; // full-screen: taken down once resolved (the door closes)
}

const ToastContext = createContext<{ push: (t: Toast, opts?: { chime?: boolean }) => void; toasts: Toast[] }>({ push: () => undefined, toasts: [] });
export const useToasts = () => useContext(ToastContext);

const LIFETIME_MS = 15_000;
const ALERT_SECONDS = 30;
const LEAVE_MS = 320; // matches the alert-out animation
const SIREN_EVERY_MS = 2_000;
const SIREN_FOR_MS = 2 * 60_000; // then the alarm stays up silently

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

type Alert = Toast & { at: number; sound: boolean };

// Corner banners: stacked top-right (top on the phone). They slide in, stay
// 15 s and can be tapped away. Full-screen alerts: one at a time over
// everything, queued, each up for its own lifetime from when it shows; a tap
// or Esc dismisses it and the next one comes in. Alarms go ahead of the
// queue (in front of an alert already showing) and stay until tapped, the
// siren repeating for up to 2 minutes. An alert with `dismissWhen` goes as
// soon as it's resolved (see the effect below). Pushing an id that is already
// shown or queued is a no-op.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef(new Map<string, number>());
  const queued = useRef(new Set<string>());
  const leavingRef = useRef(false);

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (t: Toast, opts?: { chime?: boolean }) => {
      if (t.full) {
        if (queued.current.has(t.id)) return;
        queued.current.add(t.id);
        const alert = { ...t, at: Date.now(), sound: !!opts?.chime };
        setAlerts((as) => {
          if (t.tone !== 'alarm') return [...as, alert];
          const i = as.findIndex((a) => a.tone !== 'alarm');
          return i < 0 ? [...as, alert] : [...as.slice(0, i), alert, ...as.slice(i)];
        });
        if (t.tone === 'alarm') return; // the siren plays instead
      } else {
        if (timers.current.has(t.id)) return;
        setToasts((ts) => [...ts, t]);
        timers.current.set(t.id, window.setTimeout(() => dismiss(t.id), LIFETIME_MS));
      }
      if (opts?.chime) chime();
    },
    [dismiss],
  );

  const current = alerts[0];
  const currentId = current?.id;
  const close = useCallback(() => {
    if (leavingRef.current || !currentId) return;
    leavingRef.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      queued.current.delete(currentId);
      setAlerts((as) => as.filter((a) => a.id !== currentId));
      leavingRef.current = false;
      setLeaving(false);
    }, LEAVE_MS);
  }, [currentId]);

  // Resolved alerts (the door they're about closed) go at once: the one
  // showing leaves as if tapped, siren and all; queued ones are dropped unseen.
  useEffect(() => {
    if (!alerts.some((a) => a.dismissWhen)) return;
    const check = () => {
      const states = store.getAll();
      const done = alerts.filter((a) => a.dismissWhen && isResolved(a.dismissWhen, states, a.at));
      if (!done.length) return;
      if (done[0] === current) close();
      const drop = new Set(done.filter((a) => a !== current).map((a) => a.id));
      if (!drop.size) return;
      drop.forEach((id) => queued.current.delete(id));
      setAlerts((as) => as.filter((a) => !drop.has(a.id)));
    };
    check();
    return store.subscribe(check);
  }, [alerts, current, close]);

  const alarm = current?.tone === 'alarm';
  const sound = !!current?.sound;
  const seconds = current?.seconds ?? ALERT_SECONDS;
  useEffect(() => {
    if (!currentId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    let timeout = 0;
    let interval = 0;
    if (!alarm) timeout = window.setTimeout(close, seconds * 1000);
    else if (sound) {
      const until = Date.now() + SIREN_FOR_MS;
      siren();
      interval = window.setInterval(() => (Date.now() < until ? siren() : window.clearInterval(interval)), SIREN_EVERY_MS);
    }
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      window.removeEventListener('keydown', onKey);
    };
  }, [currentId, alarm, sound, seconds, close]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  return (
    <ToastContext.Provider value={{ push, toasts }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className={`toast ${t.tone ?? 'ok'}`} onClick={() => dismiss(t.id)}>
            <span className="toast-icon"><Icon name={t.icon} size={22} /></span>
            <span className="toast-text">
              <strong>{t.title}</strong>
              {t.text && <span>{t.text}</span>}
            </span>
          </button>
        ))}
      </div>
      {current && (
        <div
          key={current.id}
          className={`alert-screen ${current.tone ?? 'ok'}${leaving ? ' leaving' : ''}`}
          role="alertdialog"
          aria-live="assertive"
          aria-label={current.title}
          style={{ '--life': `${seconds}s` } as CSSProperties}
          onClick={close}
        >
          {alerts.length > 1 && <span className="alert-count">1 of {alerts.length}</span>}
          <div className="alert-card">
            {alarm && <span className="alert-badge">Alarm</span>}
            <div className="alert-orb">
              <span className="alert-ring" />
              <span className="alert-ring" />
              <span className="alert-ring" />
              <span className="alert-glyph">{current.emoji ? <span className="alert-emoji">{current.emoji}</span> : <Icon name={current.icon} size={96} />}</span>
            </div>
            <h2 className="alert-title">{current.title}</h2>
            {current.text && <p className="alert-text">{current.text}</p>}
            <p className="alert-meta">
              {current.source ?? 'Dashboard'} · {clock(current.at)}
            </p>
          </div>
          <span className="alert-hint">{alarm ? 'Tap anywhere to silence' : alerts.length > 1 ? 'Tap for the next one' : 'Tap anywhere to dismiss'}</span>
          {!alarm && <span className="alert-life" />}
        </div>
      )}
    </ToastContext.Provider>
  );
}
