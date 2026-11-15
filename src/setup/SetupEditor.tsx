// The setup editor: the config edited on the dashboard itself, with a form for
// every setting (schema.ts), entity pickers, checks as you type and a live
// preview. It replaces editing config/dashboard.config.ts and pushing it. A save
// applies just the edits made here to the config stored in HA (useConfigSave.ts)
// and every open screen reloads onto it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, ICONS } from '../components/Icon';
import type { DashboardConfig } from '../config/types';
import { DRAFT_KEY } from '../config/load';
import { useAllEntities } from '../ha/store';
import { saveErrorText } from '../storage';
import { diff, removeAt, setAt, type Path } from './draft';
import { FieldView, type Ctx } from './FieldEditor';
import { configExport } from './exportConfig';
import { StoragePanel } from './StoragePanel';
import { blank, GROUPS, SCHEMA, SECTION_KEYS, type Section, type SectionKey } from './schema';
import { StarterButton } from './StarterButton';
import { useConfigSave, useStoredConfig } from './useConfigSave';
import { errorsOf, issuesUnder, validateConfig, REQUIRED_SECTIONS } from './validate';

type Tab = 'edit' | 'json' | 'checks' | 'storage';
type Device = 'phone' | 'tablet' | 'desktop';

const DEVICES: Record<Device, { w: number; h: number; label: string }> = {
  phone: { w: 390, h: 800, label: 'Phone' },
  tablet: { w: 1180, h: 820, label: 'Tablet' },
  desktop: { w: 1440, h: 900, label: 'Desktop' },
};

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function readDraft(): DashboardConfig | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { config?: DashboardConfig } | null;
    return d?.config ?? null;
  } catch {
    return null;
  }
}

function writeDraft(config: DashboardConfig | null) {
  try {
    if (config) localStorage.setItem(DRAFT_KEY, JSON.stringify({ config, at: Date.now() }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage blocked: the preview and "restore" don't work, editing does
  }
}

// ------------------------------------------------------------------ preview

function Preview({ config, blocked }: { config: DashboardConfig; blocked: boolean }) {
  const [device, setDevice] = useState<Device>('tablet');
  const [scale, setScale] = useState(0.5);
  const pane = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const d = DEVICES[device];

  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 2) / d.w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [d.w]);

  // The draft goes where the preview page reads it, a moment after the last edit,
  // and only while it has no errors (the page could crash on a broken one).
  useEffect(() => {
    if (blocked) return;
    const id = window.setTimeout(() => {
      writeDraft(config);
      if (loaded.current) frame.current?.contentWindow?.location.reload();
    }, 700);
    return () => window.clearTimeout(id);
  }, [config, blocked]);

  // Written before the page first loads.
  const src = useMemo(() => {
    writeDraft(config);
    const u = new URL(window.location.href);
    u.search = `?previewDraft=1&layout=${device}`;
    u.hash = '';
    return u.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  return (
    <div className="sf-preview">
      <div className="sf-preview-bar">
        <div className="sf-seg">
          {(Object.keys(DEVICES) as Device[]).map((k) => (
            <button type="button" key={k} className={device === k ? 'on' : ''} onClick={() => ((loaded.current = false), setDevice(k))}>
              {DEVICES[k].label}
            </button>
          ))}
        </div>
        <span className={`sf-preview-note ${blocked ? 'warn' : ''}`}>{blocked ? 'Paused: fix the errors to update' : 'Live data, your draft'}</span>
      </div>
      <div className="sf-preview-pane" ref={pane} style={{ height: d.h * scale }}>
        <iframe
          ref={frame}
          key={device}
          title="Preview of the draft"
          src={src}
          width={d.w}
          height={d.h}
          style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
          onLoad={() => (loaded.current = true)}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the editor

export function SetupEditor({ onClose, firstRun }: { onClose?: () => void; firstRun?: boolean }) {
  const stored = useStoredConfig();
  const doSave = useConfigSave();
  const entities = useAllEntities();

  const running = typeof window !== 'undefined' ? window.__DASHBOARD_CONFIG__ : undefined;
  const [base, setBase] = useState<DashboardConfig>(() => clone(running ?? stored?.config ?? ({} as DashboardConfig)));
  const [draft, setDraft] = useState<DashboardConfig>(() => {
    const kept = readDraft();
    return kept ? clone(kept) : clone(running ?? stored?.config ?? ({} as DashboardConfig));
  });
  const [restored] = useState(() => {
    const kept = readDraft();
    return !!kept && diff(running ?? stored?.config ?? {}, kept).length > 0;
  });
  const [tab, setTab] = useState<Tab>('edit');
  const [section, setSection] = useState<SectionKey>('ROOMS');
  const [preview, setPreview] = useState(() => !firstRun && typeof window !== 'undefined' && window.innerWidth >= 1200);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [confirmClose, setConfirmClose] = useState(false);

  const known = useMemo(() => ({ entities: new Set(Object.keys(entities)), icons: new Set(Object.keys(ICONS)) }), [entities]);
  const issues = useMemo(() => validateConfig(draft, Object.keys(entities).length ? known : { icons: known.icons }), [draft, known, entities]);
  const errors = errorsOf(issues);
  const changes = useMemo(() => diff(base, draft), [base, draft]);
  const touched = useMemo(() => new Set(changes.map((c) => c.path[0])), [changes]);

  const ctx: Ctx = useMemo(
    () => ({
      issues,
      set: (path: Path, value: unknown) => setDraft((d) => setAt(d, path, value)),
      remove: (path: Path) => setDraft((d) => removeAt(d, path)),
    }),
    [issues],
  );

  // Someone saved a newer config from another screen since this page loaded.
  const newerElsewhere = !firstRun && !!stored && !!window.__DASHBOARD_CONFIG_HASH__ && stored.hash !== window.__DASHBOARD_CONFIG_HASH__ && !import.meta.env.VITE_MOCK && !changes.length;

  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const saved = await doSave(base, draft);
      writeDraft(null);
      setBase(clone(saved.config));
      setDraft(clone(saved.config));
      setMessage({ ok: true, text: 'Saved. The dashboard reloads on every screen in a moment.' });
      window.setTimeout(() => window.location.reload(), 1400);
    } catch (e) {
      setMessage({ ok: false, text: saveErrorText(e) });
      setBusy(false);
    }
  };

  const revert = () => {
    setDraft(clone(base));
    writeDraft(null);
    setMessage(undefined);
  };

  const close = () => {
    if (changes.length && !confirmClose) return setConfirmClose(true);
    writeDraft(null);
    onClose?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !firstRun && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sec: Section = SCHEMA[section];
  const value = (draft as unknown as Record<string, unknown>)[section];
  const required = (REQUIRED_SECTIONS as readonly string[]).includes(section);
  const badge = (key: string) => {
    const mine = issuesUnder(issues, [key]);
    const e = mine.filter((i) => i.level === 'error').length;
    return e ? <span className="sf-badge">{e}</span> : mine.length ? <span className="sf-badge warn">{mine.length}</span> : null;
  };

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-label="Dashboard setup">
      <header className="setup-head">
        <h2>
          <Icon name="cog" size={22} /> {firstRun ? 'Set up your dashboard' : 'Dashboard setup'}
        </h2>
        <nav className="sf-tabs" aria-label="Setup views">
          {(
            [
              ['edit', 'Settings'],
              ['json', 'JSON'],
              ['checks', `Checks${issues.length ? ` (${issues.length})` : ''}`],
              ['storage', 'Storage'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        {!firstRun && (
          <button type="button" className={`sf-btn ${preview ? 'on' : ''}`} onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
            <Icon name="eye" size={16} /> Preview
          </button>
        )}
        {!firstRun &&
          (confirmClose ? (
            <span className="sf-confirm">
              Discard {changes.length} change{changes.length > 1 ? 's' : ''}?
              <button type="button" className="sf-btn danger" onClick={() => (writeDraft(null), onClose?.())}>
                Discard
              </button>
              <button type="button" className="sf-btn" onClick={() => setConfirmClose(false)}>
                Keep editing
              </button>
            </span>
          ) : (
            <button type="button" className="sf-btn" onClick={close} aria-label="Close setup">
              <Icon name="close" size={18} />
            </button>
          ))}
      </header>

      {(restored || newerElsewhere || firstRun) && (
        <div className="setup-banner">
          {firstRun && 'Home Assistant has no dashboard config yet. Start from what Home Assistant has, or fill the settings in by hand.'}
          {!firstRun && newerElsewhere && 'A newer config was saved from another screen. Saving here applies your edits on top of it.'}
          {!firstRun && restored && !newerElsewhere && 'Your unsaved edits from last time were restored.'}
          {firstRun && <StarterButton onPick={(c) => setDraft(c)} />}
          {restored && !firstRun && (
            <button type="button" className="sf-link" onClick={revert}>
              Discard them
            </button>
          )}
        </div>
      )}

      <div className={`setup-body ${preview ? 'with-preview' : ''}`}>
        {tab === 'edit' && (
          <>
            <aside className="setup-rail">
              <select className="sf-input sf-rail-select" value={section} onChange={(e) => setSection(e.target.value as SectionKey)} aria-label="Section">
                {SECTION_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {SCHEMA[k].title}
                  </option>
                ))}
              </select>
              {GROUPS.map((g) => (
                <div className="sf-group" key={g}>
                  <div className="sf-group-title">{g}</div>
                  {SECTION_KEYS.filter((k) => SCHEMA[k].group === g).map((k) => (
                    <button type="button" key={k} className={`sf-nav ${section === k ? 'on' : ''}`} onClick={() => setSection(k)}>
                      <span>{SCHEMA[k].title}</span>
                      {touched.has(k) && <i className="sf-dot" title="Changed" />}
                      {badge(k)}
                    </button>
                  ))}
                </div>
              ))}
            </aside>
            <main className="setup-main">
              <h3>{sec.title}</h3>
              {sec.help && <p className="sf-help">{sec.help}</p>}
              {value === undefined ? (
                <div className="sf-unset">
                  <p>{required ? 'This section is required and not filled in yet.' : 'Not set up. The dashboard uses its defaults.'}</p>
                  <button type="button" className="sf-btn primary" onClick={() => ctx.set([section], blank(sec.field))}>
                    <Icon name="plus" size={16} /> Set up {sec.title.toLowerCase()}
                  </button>
                </div>
              ) : (
                <>
                  <FieldView f={sec.field} value={value} path={[section]} ctx={ctx} bare />
                  {!required && (
                    <button type="button" className="sf-link danger" onClick={() => ctx.remove([section])}>
                      Remove this section (use the defaults)
                    </button>
                  )}
                </>
              )}
            </main>
          </>
        )}
        {tab === 'json' && <JsonTab draft={draft} onApply={(c) => setDraft(c)} />}
        {tab === 'checks' && (
          <main className="setup-main wide">
            <h3>Checks</h3>
            {!issues.length && <p className="sf-help">Nothing to report. Entities are checked against what Home Assistant has right now.</p>}
            {issues.map((i, n) => (
              <button
                type="button"
                key={n}
                className={`sf-check ${i.level}`}
                onClick={() => {
                  if (i.path[0] && (i.path[0] as string) in SCHEMA) {
                    setSection(i.path[0] as SectionKey);
                    setTab('edit');
                  }
                }}
              >
                <Icon name={i.level === 'error' ? 'alert' : 'tune'} size={16} />
                <code>{i.path.reduce<string>((s, k) => (typeof k === 'number' ? `${s}[${k + 1}]` : s ? `${s} › ${k}` : String(k)), '')}</code>
                <span>{i.message}</span>
              </button>
            ))}
          </main>
        )}
        {tab === 'storage' && (
          <main className="setup-main wide">
            <h3>Storage</h3>
            <StoragePanel />
          </main>
        )}
        {preview && !firstRun && <Preview config={draft} blocked={errors.length > 0} />}
      </div>

      <footer className="setup-foot">
        <span className={`sf-status ${errors.length ? 'bad' : ''}`}>
          {message ? <span className={message.ok ? 'ok' : 'bad'}>{message.text}</span> : errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''} to fix before saving` : changes.length ? `${changes.length} change${changes.length > 1 ? 's' : ''}, not saved` : firstRun ? 'Nothing set up yet' : 'No changes'}
        </span>
        <button type="button" className="sf-btn" onClick={() => configExport(draft)} title="Download the config as a file">
          <Icon name="download" size={16} /> Export
        </button>
        <button type="button" className="sf-btn" disabled={!changes.length || busy} onClick={revert}>
          Revert
        </button>
        <button type="button" className="sf-btn primary" disabled={busy || errors.length > 0 || (!changes.length && !firstRun)} onClick={save}>
          {busy ? 'Saving…' : firstRun ? 'Create config' : 'Save'}
        </button>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ JSON

function JsonTab({ draft, onApply }: { draft: DashboardConfig; onApply: (c: DashboardConfig) => void }) {
  const current = useMemo(() => JSON.stringify(draft, null, 2), [draft]);
  const [text, setText] = useState(current);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);

  // Follow the form while the text hasn't been edited here.
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current) setText(current);
  }, [current]);

  const apply = (src: string) => {
    try {
      const v: unknown = JSON.parse(src);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The config must be an object.');
      onApply(v as DashboardConfig);
      setError(undefined);
      edited.current = false;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="setup-main wide">
      <h3>JSON</h3>
      <p className="sf-help">The whole config as data, for pasting in a config someone shared or editing something the forms don’t reach. Nothing changes until you apply it, and the checks still run on the result.</p>
      <textarea
        className="sf-json"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          edited.current = true;
          setText(e.target.value);
        }}
      />
      {error && <div className="sf-issue error">{error}</div>}
      <div className="sf-json-tools">
        <button type="button" className="sf-btn primary" disabled={!edited.current && text === current} onClick={() => apply(text)}>
          Apply
        </button>
        <button
          type="button"
          className="sf-btn"
          onClick={() => {
            edited.current = false;
            setText(current);
            setError(undefined);
          }}
        >
          Reset text
        </button>
        <button type="button" className="sf-btn" onClick={() => file.current?.click()}>
          <Icon name="upload" size={16} /> Import a file
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const t = await f.text();
              edited.current = true;
              setText(t);
              apply(t);
            }
            e.target.value = '';
          }}
        />
      </div>
    </main>
  );
}
