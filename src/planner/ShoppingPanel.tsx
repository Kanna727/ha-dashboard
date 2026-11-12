// Shopping: HA's shopping list (PLANNER.shopping), followed live. Tick what's
// in the basket; "Clear" removes the ticked ones. Items added by voice or in the
// HA app show up here at once, and the other way round.
import { useEffect, useState } from 'react';
import { PLANNER } from '../config/entities';
import { Icon } from '../components/Icon';
import { QuickAdd, Tick, useFailToast } from './TodoPanel';
import { useHasList, useTodoActions, useTodoItems } from './usePlanner';

export function ShoppingPanel() {
  const entity = PLANNER.shopping;
  const exists = useHasList(entity);
  const items = useTodoItems(entity);
  const act = useTodoActions(entity);
  const fail = useFailToast();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  if (!exists) return null;
  const open = (items ?? []).filter((i) => i.status !== 'completed');
  const done = (items ?? []).filter((i) => i.status === 'completed');
  const add = (text: string) => act.add(text.charAt(0).toUpperCase() + text.slice(1)).catch(fail);
  return (
    <section className="panel pl-panel pl-shopping">
      <header className="panel-head">
        <h2 className="label">Shopping</h2>
        <span className="panel-summary">{items === null ? '…' : open.length ? `${open.length} to buy` : 'Nothing to buy'}</span>
      </header>
      <ul className="pl-list pl-shop-grid">
        {open.map((it) => (
          <li key={it.uid} className="pl-row">
            <Tick on={false} kind="shopping" onClick={() => void act.setDone(it, true).catch(fail)} label={`${it.summary}: tap when in the basket`} />
            <span className="pl-row-name">{it.summary}</span>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <div className="pl-done-head">
            <span>
              <Icon name="cart" size={14} /> In the basket · {done.length}
            </span>
            <button className={`pl-clear ${armed ? 'armed' : ''}`} onClick={() => (armed ? (setArmed(false), void act.clearDone().catch(fail)) : setArmed(true))}>
              {armed ? 'Tap again to clear' : 'Clear'}
            </button>
          </div>
          <ul className="pl-list pl-shop-grid">
            {done.map((it) => (
              <li key={it.uid} className="pl-row done">
                <Tick on kind="shopping" onClick={() => void act.setDone(it, false).catch(fail)} label={`${it.summary}: in the basket (tap to undo)`} />
                <span className="pl-row-name">{it.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <QuickAdd kind="shopping" placeholder="Add to the list…" onAdd={add} />
    </section>
  );
}
