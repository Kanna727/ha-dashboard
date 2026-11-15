// A text box for an entity ID that suggests the entities Home Assistant has:
// type part of an ID or a name, pick one. Typing an ID that isn't listed still
// works (an entity can be missing for a moment), the checks warn about it.
import { useMemo, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { useAllEntities } from '../ha/store';

export interface Candidate {
  id: string;
  name: string;
  state: string;
  domain: string;
}

const MAX = 40;

export function candidates(all: HassEntities): Candidate[] {
  return Object.values(all).map((e) => {
    const unit = e.attributes.unit_of_measurement as string | undefined;
    return {
      id: e.entity_id,
      name: (e.attributes.friendly_name as string | undefined) ?? e.entity_id,
      state: unit && !isNaN(Number(e.state)) ? `${e.state} ${unit}` : e.state,
      domain: e.entity_id.split('.')[0],
    };
  });
}

// Entities matching every word of `query` in their ID or name, those in the
// wanted domains first, then the better matches.
export function searchEntities(list: Candidate[], query: string, domains?: readonly string[]): Candidate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { c: Candidate; score: number }[] = [];
  for (const c of list) {
    const id = c.id.toLowerCase();
    const name = c.name.toLowerCase();
    if (!words.every((w) => id.includes(w) || name.includes(w))) continue;
    let score = 0;
    if (domains?.length) {
      if (!domains.includes(c.domain)) continue;
      score += 4 - Math.min(3, domains.indexOf(c.domain));
    }
    if (words.length && (id.startsWith(words[0]) || id.split('.')[1]?.startsWith(words[0]))) score += 3;
    if (words.length && name.startsWith(words[0])) score += 2;
    scored.push({ c, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id)).map((s) => s.c);
}

export function EntityPicker({
  value,
  onChange,
  domains,
  placeholder = 'domain.entity_name',
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  domains?: readonly string[];
  placeholder?: string;
  invalid?: boolean;
}) {
  const all = useAllEntities();
  const list = useMemo(() => candidates(all), [all]);
  const [open, setOpen] = useState(false);
  const [anyDomain, setAnyDomain] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const restrict = !anyDomain && domains?.length ? domains : undefined;
  const results = useMemo(() => (open ? searchEntities(list, value, restrict).slice(0, MAX) : []), [open, list, value, restrict]);
  const current = value ? all[value] : undefined;

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="ent-pick">
      <input
        ref={inputRef}
        className={`ent-input ${invalid ? 'bad' : ''}`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => {
          onChange(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && results[hi]) {
            e.preventDefault();
            pick(results[hi].id);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {!open && current && (
        <div className="ent-now">
          {(current.attributes.friendly_name as string | undefined) ?? current.entity_id} · {current.state}
        </div>
      )}
      {open && (
        <div className="ent-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {results.map((r, i) => (
            <button type="button" key={r.id} role="option" aria-selected={i === hi} className={`ent-opt ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(r.id)}>
              <span className="ent-name">{r.name}</span>
              <span className="ent-id">{r.id}</span>
              <span className="ent-state">{r.state}</span>
            </button>
          ))}
          {!results.length && <div className="ent-none">{list.length ? 'Nothing matches.' : 'Home Assistant has not listed its entities yet.'}</div>}
          {domains?.length ? (
            <button type="button" className="ent-more" onClick={() => setAnyDomain((a) => !a)}>
              {anyDomain ? `Only ${domains.join(', ')}` : 'Show every kind of entity'}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
