// The Storage tab: every shared document opened on this screen, how its saves are
// going and who wrote it last. For when "my change didn't show up on the other
// screen" needs an answer (src/storage/).
import { useEffect, useState } from 'react';
import { STORAGE } from '../config/entities';
import { useHassStatus } from '../ha/api';
import { store } from '../ha/store';
import { openDocs } from '../storage';
import { DEFAULT_INBOX } from '../storage/inbox';

const ago = (t?: number) => {
  if (!t) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export function StoragePanel() {
  const { isAdmin } = useHassStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1500);
    return () => window.clearInterval(id);
  }, []);
  const docs = openDocs();
  const inbox = STORAGE.inbox === false ? null : (STORAGE.inbox ?? DEFAULT_INBOX);
  const hasInbox = !!inbox && !!store.getAll()[inbox];

  return (
    <div className="sf-storage">
      <p className="sf-help">
        Everything the dashboard keeps in Home Assistant is saved through one layer: a save is applied to what is stored now, then checked, and applied again if another screen overwrote it. Only documents opened on this screen are listed.
      </p>
      <dl className="sf-facts">
        <dt>This login</dt>
        <dd>{isAdmin === undefined ? 'not known yet' : isAdmin ? 'admin: saves to the hidden dashboards' : 'not an admin: saves go to the inbox list'}</dd>
        <dt>Inbox list</dt>
        <dd>{!inbox ? 'turned off' : hasInbox ? `${inbox} (found)` : `${inbox} (not found: a non-admin login can’t save)`}</dd>
      </dl>
      <div className="sf-doc-table" role="table">
        <div className="sf-doc head" role="row">
          <span>Document</span>
          <span>Revision</span>
          <span>Last saved</span>
          <span>Saves go to</span>
          <span>State</span>
        </div>
        {docs.map((d) => {
          const s = d.status;
          const state = s.error ? s.error.message : s.retrying ? 'applying a save again' : s.pending ? `watching ${s.pending} save${s.pending > 1 ? 's' : ''}` : !s.loaded ? 'loading' : d.readOnly ? 'read only' : 'ok';
          return (
            <div className={`sf-doc ${s.error ? 'bad' : ''}`} role="row" key={d.path}>
              <span title={d.path}>
                {d.title}
                <code>{d.path}</code>
              </span>
              <span>{s.rev || '—'}</span>
              <span>
                {ago(s.at)}
                {s.by ? <code>{s.by}</code> : null}
              </span>
              <span>{d.readOnly ? '—' : s.via === 'inbox' ? 'inbox list' : 'dashboard'}</span>
              <span>{state}</span>
            </div>
          );
        })}
        {!docs.length && <div className="sf-doc">Nothing opened yet.</div>}
      </div>
    </div>
  );
}
