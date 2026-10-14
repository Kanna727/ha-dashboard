import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { chime } from '../lib/chime';

export interface Toast {
  id: string;
  title: string;
  text?: string;
  icon: IconName;
  tone?: 'ok' | 'warn';
}

const ToastContext = createContext<{ push: (t: Toast, opts?: { chime?: boolean }) => void; toasts: Toast[] }>({ push: () => undefined, toasts: [] });
export const useToasts = () => useContext(ToastContext);

const LIFETIME_MS = 15_000;

// Stacked banners in the top-right corner (top on the phone). They slide in,
// stay 15 s and can be tapped away. Pushing an id that is already shown is a no-op.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (t: Toast, opts?: { chime?: boolean }) => {
      if (timers.current.has(t.id)) return;
      setToasts((ts) => [...ts, t]);
      timers.current.set(t.id, window.setTimeout(() => dismiss(t.id), LIFETIME_MS));
      if (opts?.chime) chime();
    },
    [dismiss],
  );

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
    </ToastContext.Provider>
  );
}
