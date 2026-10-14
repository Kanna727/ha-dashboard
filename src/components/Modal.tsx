import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface ModalSpec {
  title: string;
  subtitle?: ReactNode;
  icon?: IconName;
  accent?: string; // CSS colour for the header icon badge
  aside?: ReactNode; // header right side, before the close button
  wide?: boolean;
  body: ReactNode;
}

const ModalContext = createContext<{ open: (m: ModalSpec) => void; close: () => void }>({ open: () => undefined, close: () => undefined });
export const useModal = () => useContext(ModalContext);

// Card -> detail zoom. With the View Transitions API, the tapped card and the
// modal share one `view-transition-name`, so the browser morphs one into the
// other (and back on close). Without it, or under reduced motion, the modal
// just pops in as before.
const VT_NAME = 'modal-origin';
type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
const canMorph = () =>
  typeof (document as VTDocument).startViewTransition === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function withTransition(update: () => void): Promise<void> {
  const doc = document as VTDocument;
  if (!canMorph()) {
    update();
    return Promise.resolve();
  }
  return doc.startViewTransition!(() => flushSync(update)).finished.catch(() => undefined);
}

const setVTName = (el: HTMLElement, name: string) =>
  name ? el.style.setProperty('view-transition-name', name) : el.style.removeProperty('view-transition-name');

// Full-panel detail views (car, climate, room...). Entity level sheets
// (Sheet.tsx) stack above these.
export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalSpec | null>(null);
  // The card the modal grew from: the room card or panel under the last tap.
  const lastTap = useRef<HTMLElement | null>(null);
  const origin = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      lastTap.current = (e.target as Element | null)?.closest?.('.room-row, .panel') as HTMLElement | null;
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const open = useCallback((m: ModalSpec) => {
    const from = lastTap.current?.isConnected ? lastTap.current : null;
    origin.current = from;
    if (!from || !canMorph()) return setModal(m);
    setVTName(from, VT_NAME); // old snapshot: the card
    void withTransition(() => {
      setVTName(from, ''); // new snapshot: the modal carries the name
      setModal(m);
    });
  }, []);

  const close = useCallback(() => {
    const to = origin.current?.isConnected ? origin.current : null;
    origin.current = null;
    if (!to || !canMorph()) return setModal(null);
    void withTransition(() => {
      setModal(null);
      setVTName(to, VT_NAME); // shrink back into the card
    }).then(() => setVTName(to, ''));
  }, []);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, close]);

  return (
    <ModalContext.Provider value={{ open, close }}>
      {children}
      {modal && (
        <div className="modal-backdrop" onClick={close}>
          <div
            className={`modal ${modal.wide ? 'wide' : ''} ${origin.current && canMorph() ? 'morph' : ''}`}
            style={origin.current && canMorph() ? ({ viewTransitionName: VT_NAME } as React.CSSProperties) : undefined}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={modal.title}
          >
            <header className="modal-head">
              {modal.icon && (
                <span className="modal-badge" style={modal.accent ? { background: modal.accent } : undefined}>
                  <Icon name={modal.icon} size={30} />
                </span>
              )}
              <div className="modal-titles">
                <h2>{modal.title}</h2>
                {modal.subtitle && <div className="modal-sub">{modal.subtitle}</div>}
              </div>
              {modal.aside}
              <button className="round" onClick={close} aria-label="Close">
                <Icon name="close" size={22} />
              </button>
            </header>
            <div className="modal-body">{modal.body}</div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}

// Section header used by every dashboard panel: LABEL · summary · chevron.
export function PanelHead({ label, summary, summaryClass, onMore }: { label: string; summary?: ReactNode; summaryClass?: string; onMore?: () => void }) {
  return (
    <header className="panel-head">
      <h2 className="label">{label}</h2>
      {summary !== undefined && <span className={`panel-summary ${summaryClass ?? ''}`}>{summary}</span>}
      {onMore && (
        <button className="round small chevron" onClick={onMore} aria-label={`Open ${label.toLowerCase()}`}>
          <Icon name="chevronRight" size={20} />
        </button>
      )}
    </header>
  );
}
