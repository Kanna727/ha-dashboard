// A form for any part of the config, drawn from its schema (schema.ts): the
// editor walks the draft and the schema together. Every edit goes through
// `ctx.set(path, value)` (undefined removes it), so nothing here holds state of
// its own besides which list items are expanded.
import { useState, type ReactNode } from 'react';
import { Icon, ICONS, type IconName } from '../components/Icon';
import { isPlainObject } from '../storage/envelope';
import { moveItem, type Path } from './draft';
import { EntityPicker } from './EntityPicker';
import { blank, labelOf, type Field } from './schema';
import type { Issue } from './validate';

export interface Ctx {
  issues: Issue[];
  set: (path: Path, value: unknown) => void;
  remove: (path: Path) => void;
}

const ICON_NAMES = Object.keys(ICONS).sort();
const same = (a: Path, b: Path) => a.length === b.length && a.every((k, i) => k === b[i]);

function Issues({ ctx, path }: { ctx: Ctx; path: Path }) {
  const mine = ctx.issues.filter((i) => same(i.path, path));
  if (!mine.length) return null;
  return (
    <div className="sf-issues">
      {mine.map((i, n) => (
        <div key={n} className={`sf-issue ${i.level}`}>
          {i.message}
        </div>
      ))}
    </div>
  );
}

const hasError = (ctx: Ctx, path: Path) => ctx.issues.some((i) => i.level === 'error' && same(i.path, path));
const isPrimitive = (f: Field) => f.t === 'entity' || f.t === 'string' || f.t === 'number' || f.t === 'bool' || f.t === 'enum';

// What kind of value fits a field, for choosing between the two sides of "either".
function fits(f: Field, v: unknown): boolean {
  switch (f.t) {
    case 'entity':
    case 'string':
    case 'enum':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number';
    case 'bool':
      return typeof v === 'boolean';
    case 'list':
    case 'multi':
    case 'tuple':
      return Array.isArray(v);
    case 'object':
    case 'map':
      return isPlainObject(v);
    case 'either':
      return fits(f.a, v) || fits(f.b, v);
  }
}

const KIND_LABEL: Record<Field['t'], string> = { entity: 'Entity', string: 'Text', number: 'Number', bool: 'On / off', enum: 'Choice', multi: 'Choices', list: 'List', object: 'Detailed', map: 'Entries', tuple: 'Pair', either: 'Either' };

// ------------------------------------------------------------ leaf controls

function Leaf({ f, value, path, ctx }: { f: Field; value: unknown; path: Path; ctx: Ctx }) {
  const bad = hasError(ctx, path);
  const set = (v: unknown) => ctx.set(path, v);
  switch (f.t) {
    case 'entity':
      return <EntityPicker value={typeof value === 'string' ? value : ''} domains={f.domains} invalid={bad} onChange={(v) => set(v === '' && !f.req ? undefined : v)} />;
    case 'string': {
      const text = typeof value === 'string' ? value : '';
      const edit = (v: string) => set(v === '' && !f.req ? undefined : v);
      if (f.kind === 'time') return <input className={`sf-input ${bad ? 'bad' : ''}`} type="time" value={text} onChange={(e) => edit(e.target.value)} />;
      if (f.kind === 'color')
        return (
          <div className="sf-color">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(text) ? text : '#808080'} onChange={(e) => edit(e.target.value)} aria-label="Pick a colour" />
            <input className={`sf-input ${bad ? 'bad' : ''}`} value={text} placeholder="#rrggbb" spellCheck={false} onChange={(e) => edit(e.target.value)} />
          </div>
        );
      if (f.kind === 'icon') {
        const names = text && !ICON_NAMES.includes(text) ? [text, ...ICON_NAMES] : ICON_NAMES;
        return (
          <div className="sf-icon">
            <span className="sf-icon-prev">{text && text in ICONS ? <Icon name={text as IconName} size={22} /> : null}</span>
            <select className={`sf-input ${bad ? 'bad' : ''}`} value={text} onChange={(e) => edit(e.target.value)}>
              <option value="">{f.req ? 'Pick an icon' : '(default)'}</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        );
      }
      return <input className={`sf-input ${bad ? 'bad' : ''}`} value={text} placeholder={f.placeholder} spellCheck={false} onChange={(e) => edit(e.target.value)} />;
    }
    case 'number':
      return (
        <div className="sf-num">
          <input
            className={`sf-input ${bad ? 'bad' : ''}`}
            type="number"
            inputMode="decimal"
            value={typeof value === 'number' ? value : ''}
            min={f.min}
            max={f.max}
            step={f.step ?? 'any'}
            onChange={(e) => set(e.target.value === '' ? (f.req ? (f.min ?? 0) : undefined) : Number(e.target.value))}
          />
          {f.unit && <span className="sf-unit">{f.unit}</span>}
        </div>
      );
    case 'bool':
      return (
        <button type="button" role="switch" aria-checked={value === true} className={`sf-switch ${value === true ? 'on' : ''}`} onClick={() => set(value !== true)}>
          <span />
        </button>
      );
    case 'enum':
      return (
        <select className={`sf-input ${bad ? 'bad' : ''}`} value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)}>
          {!f.req && <option value="">(default)</option>}
          {f.options.map((o) => (
            <option key={o} value={o}>
              {f.labels?.[o] ?? o}
            </option>
          ))}
        </select>
      );
    case 'multi': {
      const chosen = new Set((Array.isArray(value) ? value : []).map(String));
      const toggle = (o: string) => {
        const next = f.options.filter((x) => (x === o ? !chosen.has(o) : chosen.has(x)));
        set(f.numeric ? next.map(Number) : next);
      };
      return (
        <div className="sf-chips">
          {f.options.map((o) => (
            <button type="button" key={o} className={`sf-chip ${chosen.has(o) ? 'on' : ''}`} aria-pressed={chosen.has(o)} onClick={() => toggle(o)}>
              {f.labels?.[o] ?? o}
            </button>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ rows

function Row({ label, help, req, children, path, ctx, onReset }: { label: string; help?: string; req?: boolean; children: ReactNode; path: Path; ctx: Ctx; onReset?: () => void }) {
  return (
    <div className="sf-row">
      <div className="sf-head">
        <span className="sf-label">
          {label}
          {req ? <i title="Required"> *</i> : null}
        </span>
        {onReset && (
          <button type="button" className="sf-reset" onClick={onReset} title="Remove this setting (use the default)" aria-label={`Remove ${label}`}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      {children}
      {help && <div className="sf-help">{help}</div>}
      <Issues ctx={ctx} path={path} />
    </div>
  );
}

function ItemTools({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (to: number) => void; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <span className="sf-tools" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={i === 0} onClick={() => onMove(i - 1)} aria-label="Move up">
        <Icon name="up" size={16} />
      </button>
      <button type="button" disabled={i === n - 1} onClick={() => onMove(i + 1)} aria-label="Move down">
        <Icon name="down" size={16} />
      </button>
      <button
        type="button"
        className={`danger ${sure ? 'confirm' : ''}`}
        onClick={() => (sure ? onRemove() : (setSure(true), window.setTimeout(() => setSure(false), 3000)))}
        aria-label={sure ? 'Tap again to delete' : 'Delete'}
      >
        {sure ? <span className="sf-sure">Delete?</span> : <Icon name="trash" size={16} />}
      </button>
    </span>
  );
}

// ------------------------------------------------------------------ the form

export function FieldView({ f, value, path, ctx, label, bare }: { f: Field; value: unknown; path: Path; ctx: Ctx; label?: string; bare?: boolean }) {
  const name = label ?? labelOf(String(path[path.length - 1] ?? ''), f);
  // Both are used by only some kinds of field, but hooks can't be conditional (an either-or switches kinds in place).
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [draftKey, setDraftKey] = useState('');
  const wrap = (body: ReactNode, reset = false) =>
    bare ? (
      <>
        {body}
        <Issues ctx={ctx} path={path} />
      </>
    ) : (
      <Row label={name} help={f.help} req={f.req} path={path} ctx={ctx} onReset={reset && !f.req && value !== undefined ? () => ctx.remove(path) : undefined}>
        {body}
      </Row>
    );

  if (isPrimitive(f) || f.t === 'multi') return wrap(<Leaf f={f} value={value} path={path} ctx={ctx} />, true);

  switch (f.t) {
    case 'tuple': {
      const arr = Array.isArray(value) ? value : [];
      return wrap(
        <div className="sf-tuple">
          {f.of.map((sub, i) => (
            <label key={i}>
              <span>{f.labels?.[i] ?? i + 1}</span>
              <FieldView f={sub} value={arr[i]} path={[...path, i]} ctx={ctx} bare />
            </label>
          ))}
        </div>,
        true,
      );
    }

    case 'either': {
      const v = fits(f.a, value) ? 0 : fits(f.b, value) ? 1 : 0;
      const side = v === 0 ? f.a : f.b;
      return wrap(
        <div className="sf-either">
          <div className="sf-seg">
            {[f.a, f.b].map((variant, i) => (
              <button type="button" key={i} className={v === i ? 'on' : ''} onClick={() => v !== i && ctx.set(path, blank(variant))}>
                {KIND_LABEL[variant.t]}
              </button>
            ))}
          </div>
          <FieldView f={side} value={value} path={path} ctx={ctx} bare />
        </div>,
        true,
      );
    }

    case 'list': {
      const items = Array.isArray(value) ? value : [];
      const prim = isPrimitive(f.of);
      const add = () => {
        ctx.set([...path], [...items, blank(f.of)]);
        if (!prim) setOpen((o) => new Set(o).add(items.length));
      };
      return wrap(
        <div className="sf-list">
          {items.map((item, i) => {
            const p: Path = [...path, i];
            const move = (to: number) => ctx.set(path, moveItem(items, i, to));
            if (prim)
              return (
                <div className="sf-prim" key={i}>
                  <FieldView f={f.of} value={item} path={p} ctx={ctx} bare />
                  <ItemTools i={i} n={items.length} onMove={move} onRemove={() => ctx.remove(p)} />
                </div>
              );
            const title = f.title && isPlainObject(item) && typeof item[f.title] === 'string' && item[f.title] ? String(item[f.title]) : `${labelOf(f.item ?? 'item')} ${i + 1}`;
            const shown = open.has(i);
            const bad = ctx.issues.filter((x) => x.level === 'error' && p.every((k, n) => x.path[n] === k)).length;
            return (
              <div className={`sf-card ${bad ? 'bad' : ''}`} key={i}>
                <div className="sf-card-head" role="button" tabIndex={0} aria-expanded={shown} onClick={() => setOpen((o) => (o.has(i) ? new Set([...o].filter((x) => x !== i)) : new Set(o).add(i)))} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen((o) => (o.has(i) ? new Set([...o].filter((x) => x !== i)) : new Set(o).add(i))))}>
                  <Icon name={shown ? 'down' : 'chevronRight'} size={18} />
                  <span className="sf-card-title">{title}</span>
                  {bad ? <span className="sf-badge">{bad}</span> : null}
                  <ItemTools i={i} n={items.length} onMove={move} onRemove={() => ctx.remove(p)} />
                </div>
                {shown && (
                  <div className="sf-card-body">
                    <FieldView f={f.of} value={item} path={p} ctx={ctx} bare />
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="sf-add" onClick={add}>
            <Icon name="plus" size={16} /> Add {f.item ?? 'item'}
          </button>
        </div>,
      );
    }

    case 'object': {
      const obj = isPlainObject(value) ? value : {};
      const extra = Object.keys(obj).filter((k) => !(k in f.fields));
      const body = (
        <div className="sf-obj">
          {Object.entries(f.fields).map(([k, sub]) => {
            const v = obj[k];
            const p: Path = [...path, k];
            if (sub.t === 'object' && v === undefined && !sub.req)
              return (
                <div className="sf-row" key={k}>
                  <button type="button" className="sf-add" onClick={() => ctx.set(p, blank(sub))}>
                    <Icon name="plus" size={16} /> Set up {labelOf(k, sub).toLowerCase()}
                  </button>
                  {sub.help && <div className="sf-help">{sub.help}</div>}
                </div>
              );
            return <FieldView key={k} f={sub} value={v} path={p} ctx={ctx} />;
          })}
          {extra.length > 0 && (
            <div className="sf-extra">
              <div className="sf-label">Other settings the editor doesn’t know</div>
              {extra.map((k) => (
                <div className="sf-extra-row" key={k}>
                  <code>{k}</code>
                  <span>{JSON.stringify(obj[k]).slice(0, 80)}</span>
                  <button type="button" className="sf-reset" onClick={() => ctx.remove([...path, k])} aria-label={`Remove ${k}`}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
      return bare ? body : wrap(body, true);
    }

    case 'map': {
      const entries = Object.entries(isPlainObject(value) ? value : {});
      const left = f.keyOptions?.filter((o) => !(o in (isPlainObject(value) ? value : {}))) ?? [];
      const addKey = (k: string) => {
        if (!k || (isPlainObject(value) && k in value)) return;
        ctx.set([...path, k], blank(f.of));
        setDraftKey('');
      };
      return wrap(
        <div className="sf-map">
          {entries.map(([k, v]) => (
            <div className="sf-map-row" key={k}>
              <div className="sf-map-key">
                {f.keyOptions ? <span>{f.keyLabels?.[k] ?? k}</span> : <code>{k}</code>}
                <button type="button" className="sf-reset" onClick={() => ctx.remove([...path, k])} aria-label={`Remove ${k}`}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <FieldView f={f.of} value={v} path={[...path, k]} ctx={ctx} bare={isPrimitive(f.of) || f.of.t === 'tuple'} label={k} />
            </div>
          ))}
          <div className="sf-map-add">
            {f.keyOptions ? (
              left.length > 0 && (
                <select className="sf-input" value="" onChange={(e) => addKey(e.target.value)}>
                  <option value="">+ Add {f.keyHelp ?? 'entry'}…</option>
                  {left.map((o) => (
                    <option key={o} value={o}>
                      {f.keyLabels?.[o] ?? o}
                    </option>
                  ))}
                </select>
              )
            ) : f.keyKind === 'entity' ? (
              <EntityPicker value={draftKey} domains={f.keyDomains} placeholder={`+ Add ${f.keyDomains?.[0] ?? 'entity'}…`} onChange={(v) => (/^[a-z_]+\.[a-z0-9_]+$/.test(v) ? addKey(v) : setDraftKey(v))} />
            ) : (
              <div className="sf-map-new">
                <input className="sf-input" value={draftKey} placeholder={`New ${f.keyHelp ?? 'name'}`} onChange={(e) => setDraftKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKey(draftKey.trim())} />
                <button type="button" className="sf-add" disabled={!draftKey.trim()} onClick={() => addKey(draftKey.trim())}>
                  <Icon name="plus" size={16} /> Add
                </button>
              </div>
            )}
          </div>
        </div>,
      );
    }
  }
  return null;
}
