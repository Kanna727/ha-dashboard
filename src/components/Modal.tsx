import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
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

// Full-panel detail views (car, climate, room...). Entity level sheets
// (Sheet.tsx) stack above these.
export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const open = useCallback((m: ModalSpec) => setModal(m), []);
  const close = useCallback(() => setModal(null), []);

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
          <div className={`modal ${modal.wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={modal.title}>
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
