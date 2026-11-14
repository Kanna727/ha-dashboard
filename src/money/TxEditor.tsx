import { useMemo, useState, type ReactNode } from 'react';
import { useModal } from '../components/Modal';
import { fmtInr } from '../lib/finance';
import { groupOf, type TxGroup } from '../lib/financeDetail';
import { diffPatch, withAdded, withChange, withHidden, withoutAdded, type ViewTx } from '../lib/txEdits';
import { useFinance } from './useFinance';
import { useMoneyHistory, useSnapshot } from './useMoneyHistory';
import { saveErrorText, useSaveTxEdits, useTxView } from './useTxEdits';

// Adding or changing a transaction on the Money page (the owner asked on
// 2026-11-08; Home Assistant is the source of truth, nothing goes back to the
// money app). Name (the owner's own title), merchant, spent or received,
// amount, date and time, category, subcategory and account. Delete removes a
// transaction the owner added; a synced one is hidden instead (it drops out of
// the list and the totals, and can be unhidden).

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (s: string) => {
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : undefined;
};
const fmtWhenFull = (t: number) =>
  new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(/^(\d+ )(\w)/, (_, a, b) => a + b.toUpperCase());

// What to suggest in each field: everything already seen.
function useOptions(view: ViewTx[]) {
  const f = useFinance();
  const h = useMoneyHistory();
  const snap = useSnapshot();
  return useMemo(() => {
    const cats = new Set<string>();
    const subs = new Map<string, Set<string>>();
    const merchants = new Set<string>();
    const accounts = new Set<string>(['Cash']);
    const addSub = (c: string, s: string) => {
      if (!subs.has(c)) subs.set(c, new Set());
      subs.get(c)!.add(s);
    };
    for (const t of view) {
      if (t.category) cats.add(t.category);
      if (t.category && t.sub) addSub(t.category, t.sub);
      if (t.merchant) merchants.add(t.merchant);
      if (t.account) accounts.add(t.account);
    }
    for (const m of h.months) for (const [c] of m.categories) cats.add(c);
    for (const c of snap.spending?.categories ?? []) {
      cats.add(c.name);
      for (const [s] of c.subs) if (s !== 'Other') addSub(c.name, s);
    }
    for (const a of [...(f?.banks ?? []), ...(f?.cards ?? [])]) accounts.add(a.last4 ? `${a.name} ••${a.last4}` : a.name);
    cats.delete('Untagged');
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { cats: sort(cats), subs, merchants: sort(merchants), accounts: sort(accounts) };
  }, [view, h.months, snap.spending, f?.banks, f?.cards]);
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`txe-field ${wide ? 'wide' : ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

// A text box that lists every option when focused (a browser datalist only
// lists the ones matching what is typed) and narrows the list once you type.
function Combo({ value, onChange, options, placeholder, maxLength }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; maxLength?: number }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const q = value.trim().toLowerCase();
  const list = typed && q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const close = () => {
    setOpen(false);
    setTyped(false);
  };
  return (
    <div className="txe-combo">
      <input
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), close())}
      />
      {open && list.length > 0 && (
        <ul className="txe-opts" role="listbox">
          {list.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              className={o === value ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o);
                close();
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TxEditor({ tx, onDone }: { tx?: ViewTx; onDone: () => void }) {
  const view = useTxView();
  const opts = useOptions(view);
  const save = useSaveTxEdits();
  const now = Date.now();
  const [name, setName] = useState(tx?.note ?? '');
  const [merchant, setMerchant] = useState(tx?.merchant ?? '');
  const [kind, setKind] = useState<'out' | 'in'>(tx && tx.amount > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(tx ? String(Math.abs(tx.amount)) : '');
  const [when, setWhen] = useState(toLocalInput(tx?.t ?? now));
  const [category, setCategory] = useState(tx?.category ?? '');
  const [sub, setSub] = useState(tx?.sub ?? '');
  const [account, setAccount] = useState(tx?.account ?? 'Cash');
  // '' = automatic (from the category and direction), for a transaction not saved yet.
  const [group, setGroup] = useState<TxGroup | ''>(tx ? groupOf(tx) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState(false);

  const value = parseFloat(amount.replace(/,/g, ''));
  const t = fromLocalInput(when);
  const ok = Number.isFinite(value) && value > 0 && t !== undefined && t <= now + 60_000 && (!!merchant.trim() || !!name.trim());
  const signed = kind === 'out' ? -value : value;
  const subsFor = [...(opts.subs.get(category.trim()) ?? [])].sort((a, b) => a.localeCompare(b));

  const run = async (change: Parameters<typeof save>[0]) => {
    setBusy(true);
    setError(undefined);
    try {
      await save(change);
      onDone();
    } catch (e) {
      setError(saveErrorText(e));
      setBusy(false);
    }
  };

  const fields = { note: name, merchant, amount: signed, t: t!, category, sub, account, group: group || undefined };
  const onSave = () => {
    if (!ok) return;
    if (!tx || tx.source === 'added') {
      const id = tx?.key ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const trim = (s: string) => s.trim() || undefined;
      void run((e) =>
        withAdded(e, { id, t: t!, amount: signed, note: trim(name), merchant: trim(merchant), category: trim(category), sub: trim(sub), account: trim(account), group: group || undefined }),
      );
    } else {
      void run((e) => withChange(e, tx.key, tx.orig!, diffPatch(tx.orig!, fields)));
    }
  };
  const onRemove = () => {
    if (!tx) return;
    if (!confirm) {
      setConfirm(true);
      window.setTimeout(() => setConfirm(false), 4000);
      return;
    }
    void run((e) => (tx.source === 'added' ? withoutAdded(e, tx.key) : withHidden(e, tx.key, tx.orig!, true)));
  };

  const o = tx?.orig;
  return (
    <div className="txe">
      {tx?.source === 'synced' && o && (
        <p className="txe-orig">
          From the money app: <b>{o.merchant ?? o.notes ?? 'Unknown'}</b> · {o.amount > 0 ? '+' : ''}
          {fmtInr(o.amount, o.amount % 1 ? 2 : 0)} · {fmtWhenFull(o.t)}
          {o.category ? ` · ${[o.category, o.sub].filter(Boolean).join(' · ')}` : ''}
          {tx.hidden && <span className="money-chip bad">Hidden</span>}
        </p>
      )}
      <div className="segmented small txe-kind">
        <button className={kind === 'out' ? 'active' : ''} onClick={() => setKind('out')}>
          Spent
        </button>
        <button className={kind === 'in' ? 'active' : ''} onClick={() => setKind('in')}>
          Received
        </button>
      </div>
      <div className="txe-grid">
        <Field label="Name" wide>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your own name for it (optional)" maxLength={80} />
        </Field>
        <Field label="Merchant">
          <Combo value={merchant} onChange={setMerchant} options={opts.merchants} placeholder="Who was paid" maxLength={80} />
        </Field>
        <Field label="Amount (₹)">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Date and time">
          <input type="datetime-local" value={when} max={toLocalInput(now)} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Account">
          <Combo value={account} onChange={setAccount} options={opts.accounts} maxLength={80} />
        </Field>
        <Field label="Group">
          <select value={group} onChange={(e) => setGroup(e.target.value as TxGroup | '')}>
            {!tx && <option value="">Automatic</option>}
            <option value="spend">Spends</option>
            <option value="income">Income</option>
            <option value="move">Transfers</option>
            <option value="invest">Investments</option>
          </select>
        </Field>
        <Field label="Category">
          <Combo value={category} onChange={setCategory} options={opts.cats} placeholder="Untagged" maxLength={60} />
        </Field>
        <Field label="Subcategory">
          <Combo value={sub} onChange={setSub} options={subsFor} maxLength={60} />
        </Field>
      </div>
      {!ok && amount !== '' && <p className="txe-hint">Needs an amount above zero, a merchant or a name, and a time that isn't in the future.</p>}
      {error && <p className="net-name-error">{error}</p>}
      <div className="net-name-actions">
        <button className="chip-btn active" disabled={!ok || busy} onClick={onSave}>
          {busy ? 'Saving…' : tx ? 'Save' : 'Add'}
        </button>
        {tx?.source === 'synced' && tx.hidden && (
          <button className="chip-btn" disabled={busy} onClick={() => void run((e) => withHidden(e, tx.key, tx.orig!, false))}>
            Unhide
          </button>
        )}
        {tx?.source === 'synced' && tx.edited && (
          <button className="chip-btn" disabled={busy} onClick={() => void run((e) => withChange(e, tx.key, tx.orig!, null))}>
            Undo my changes
          </button>
        )}
        {tx && !(tx.source === 'synced' && tx.hidden) && (
          <button className={`chip-btn danger ${confirm ? 'confirm' : ''}`} disabled={busy} onClick={onRemove}>
            {confirm ? (tx.source === 'added' ? 'Tap again to delete' : 'Tap again to hide') : tx.source === 'added' ? 'Delete' : 'Hide'}
          </button>
        )}
        <button className="chip-btn" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="muted small txe-foot">
        {tx?.source === 'synced'
          ? 'Your changes are kept in Home Assistant and count in every total. The money app’s own copy isn’t changed; Hide takes it out of the list and the totals.'
          : 'Kept in Home Assistant, so every screen shows it, and it counts in the totals.'}
      </p>
    </div>
  );
}

export function useTxEditor() {
  const { open, close } = useModal();
  return (tx?: ViewTx) =>
    open({
      title: tx ? 'Edit transaction' : 'Add a transaction',
      icon: tx ? 'pencil' : 'plus',
      accent: 'var(--accent-light)',
      body: <TxEditor tx={tx} onDone={close} />,
    });
}
