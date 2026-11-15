// House insights: what the last days of history say is unusual right now (a door
// opened in the small hours, a geyser left on, a device using far more energy
// than it does on such a day) and habits worth automating, each with the
// automation to add in one tap. Learned from Home Assistant's own history on this
// screen: nothing leaves the house (lib/insights/).
import { useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { relTime } from '../ha/format';
import { describe, type Insight } from '../lib/insights';
import { saveErrorText } from '../money/useTxEdits';
import { useInsights } from './useInsights';

const ICON: Record<Insight['kind'], IconName> = {
  'energy-high': 'flash',
  'energy-low': 'flash',
  'left-on': 'timer',
  habit: 'history',
  'door-odd-hour': 'doorOpen',
  'door-open-long': 'doorOpen',
};

function Row({ i, added, canSuggest, onDismiss, onAccept }: { i: Insight; added?: { automation: string }; canSuggest: boolean; onDismiss: (forever: boolean) => void; onAccept: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const s = i.suggestion;
  return (
    <li className={`ins-row ${i.severity}`}>
      <div className="ins-main">
        <span className="ins-icon" aria-hidden>
          <Icon name={ICON[i.kind]} size={20} />
        </span>
        <div className="ins-text">
          <b>{i.title}</b>
          <small className="muted">
            {i.detail}
            {i.kind !== 'habit' && ` · ${relTime(i.at)}`}
          </small>
        </div>
        <div className="ins-act">
          {added ? (
            <span className="ins-done">
              <Icon name="check" size={16} /> Added
            </span>
          ) : s && !s.covered && canSuggest ? (
            <button type="button" className="chip-btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide' : 'Automate'}
            </button>
          ) : null}
          <button type="button" className="ins-x" onClick={() => onDismiss(false)} aria-label="Not now" title="Not now">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
      {s?.covered && !added && (
        <p className="ins-note">
          <Icon name="check" size={14} /> “{s.covered}” already seems to do this.
        </p>
      )}
      {open && s && (
        <div className="ins-draft">
          <b>{s.title}</b>
          <p className="muted">{s.why}</p>
          <ol>
            {describe(s.draft, () => i.name).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
          <small className="muted">Added to Home Assistant as “{s.draft.alias}”; you can edit or delete it there like any automation.</small>
          {error && <p className="ins-err">{error}</p>}
          <div className="ins-buttons">
            <button
              type="button"
              className="chip-btn small active"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  await onAccept();
                  setOpen(false);
                } catch (e) {
                  setError(saveErrorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Adding…' : 'Add this automation'}
            </button>
            <button type="button" className="chip-btn small" onClick={() => onDismiss(true)}>
              Don’t suggest this again
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function InsightsPanel() {
  const { insights, added, read, at, loading, error, dismiss, accept } = useInsights();
  const [habits, setHabits] = useState(false);
  const [allHabits, setAllHabits] = useState(false);
  const attention = insights.filter((i) => i.kind !== 'habit');
  const habitList = insights.filter((i) => i.kind === 'habit');
  if (loading && !at) {
    return (
      <section className="panel insights">
        <header className="panel-head">
          <h2 className="label">House insights</h2>
        </header>
        <p className="muted">Reading the last days of history…</p>
      </section>
    );
  }
  return (
    <section className="panel insights">
      <header className="panel-head">
        <h2 className="label">House insights</h2>
        <span className="panel-summary">{attention.length ? `${attention.length} to look at` : 'nothing unusual'}</span>
      </header>
      {error && !at && <p className="ins-err">Couldn’t read the history ({error}).</p>}
      {!attention.length && at && <p className="muted ins-empty">Nothing unusual in the last 10 days of {read} devices, doors and plugs.</p>}
      <ul className="ins-list">
        {attention.map((i) => (
          <Row key={i.id} i={i} added={i.suggestion ? added[i.suggestion.id] : undefined} canSuggest onDismiss={(f) => void dismiss(i, f)} onAccept={() => accept(i)} />
        ))}
      </ul>
      {habitList.length > 0 && (
        <>
          <button type="button" className="ins-habits" aria-expanded={habits} onClick={() => setHabits((h) => !h)}>
            <Icon name={habits ? 'down' : 'chevronRight'} size={16} /> Habits it noticed ({habitList.length})
          </button>
          {habits && (
            <>
              <ul className="ins-list">
                {(allHabits ? habitList : habitList.slice(0, 6)).map((i) => (
                  <Row key={i.id} i={i} added={i.suggestion ? added[i.suggestion.id] : undefined} canSuggest onDismiss={(f) => void dismiss(i, f)} onAccept={() => accept(i)} />
                ))}
              </ul>
              {habitList.length > 6 && (
                <button type="button" className="ins-habits" onClick={() => setAllHabits((a) => !a)}>
                  {allHabits ? 'Show fewer' : `Show all ${habitList.length}`}
                </button>
              )}
            </>
          )}
        </>
      )}
      <p className="ins-foot muted">Learned from Home Assistant’s own history on this screen, no cloud. Suggestions are only added when you tap.</p>
    </section>
  );
}
