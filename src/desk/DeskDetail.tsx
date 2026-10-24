import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DESK } from '../config/entities';
import { useHass, type HistoryPoint } from '../ha/api';
import { useEntities, useEntity } from '../ha/store';
import { num } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';
import { Slider } from '../components/Slider';
import { useNow } from '../hooks/useNow';
import { ConfirmButton, EntityControl, Row, Toggle, sensorText } from '../vacuum/controls';
import { dailyStanding, displayHeight, fmtDuration, fmtIdle, heightToPosition, isStanding, postureStats, type DeskIds } from '../lib/desk';
import { DeskArt } from './DeskArt';
import { DeskViewer } from './desk3d';
import { useDeskHistory, useDeskIds, useDeskLive, usePresetHeights, type DeskLive } from './useDesk';

// The desk's popup: the desk in 3D at its live height with up/down buttons
// (tap = nudge, hold = keep moving), the memory keys (with the heights they go
// to) and saving to them, a slider to send it to any height, today's and this
// week's standing, and the controller (child lock, idle counter, calibration, restart).

export function DeskSubtitle() {
  const ids = useDeskIds();
  const live = useDeskLive(ids);
  const { line } = usePresetHeights(ids, live);
  if (live.offline) return <span className="muted">Offline</span>;
  const what = live.moving ? (live.moving === 'up' ? 'Rising' : 'Lowering') : isStanding(live.height, line) ? 'Standing height' : 'Sitting height';
  return (
    <span className="muted">
      {what} · {displayHeight(live.height)} cm
    </span>
  );
}

/* ---------- the 3D stage ---------- */

function DeskStage({ live, target, standing, children }: { live: DeskLive; target?: number; standing: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<DeskViewer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !canvas.current) return;
    try {
      viewer.current = new DeskViewer(canvas.current, DESK.look);
      // Mock builds: poke it from the console.
      if (import.meta.env.VITE_MOCK) (window as unknown as { __deskViewer?: DeskViewer }).__deskViewer = viewer.current;
    } catch {
      setFailed(true);
      return;
    }
    const ro = new ResizeObserver(() => viewer.current?.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    viewer.current.resize(el.clientWidth, el.clientHeight);
    const onVisible = () => !document.hidden && viewer.current?.wake();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    viewer.current?.setHeight(live.height);
    viewer.current?.setDisplay(displayHeight(live.height));
  }, [live.height, failed]);
  useEffect(() => viewer.current?.setTarget(target), [target]);

  return (
    <div className={`desk-stage ${live.moving ? 'moving' : ''}`} ref={box}>
      {failed ? (
        <div className="desk-stage-art">
          <DeskArt height={live.height} min={live.min} max={live.max} size={220} />
        </div>
      ) : (
        <canvas ref={canvas} className="desk-stage-canvas" aria-label="The desk in 3D" />
      )}
      <div className="desk-readout">
        <div className="desk-readout-val">
          {displayHeight(live.height)}
          <small>cm</small>
        </div>
        <div className={`desk-readout-sub ${standing ? 'standing' : ''}`}>
          {live.offline ? (
            'Offline'
          ) : live.moving ? (
            <>
              <Icon name={live.moving === 'up' ? 'raise' : 'lower'} size={16} className="desk-moving" />
              {live.moving === 'up' ? 'Rising' : 'Lowering'}
            </>
          ) : (
            <>
              <Icon name={standing ? 'standing' : 'chair'} size={16} />
              {standing ? 'Standing height' : 'Sitting height'}
            </>
          )}
        </div>
        {target !== undefined && <div className="desk-readout-target">Go to {target.toFixed(1)} cm</div>}
      </div>
      {children}
    </div>
  );
}

/* ---------- moving ---------- */

const HOLD_MS = 350; // pressed longer than this = a hold, not a tap

// Up and down, like the keypad's arrows: a tap nudges the desk one step
// (~1 cm), holding keeps it moving until released (the cover heads for the
// end of the range and Stop is sent on release). Without nudge buttons the
// press itself starts the move.
function HoldButton({ dir, disabled, active, onTap, onStart, onStop }: { dir: 'up' | 'down'; disabled?: boolean; active: boolean; onTap?: () => void; onStart: () => void; onStop: () => void }) {
  const state = useRef<'idle' | 'pressed' | 'holding'>('idle');
  const timer = useRef(0);
  const start = () => {
    if (state.current !== 'idle') return;
    if (!onTap) {
      state.current = 'holding';
      return onStart();
    }
    state.current = 'pressed';
    timer.current = window.setTimeout(() => {
      state.current = 'holding';
      onStart();
    }, HOLD_MS);
  };
  const end = () => {
    window.clearTimeout(timer.current);
    if (state.current === 'pressed') onTap?.();
    else if (state.current === 'holding') onStop();
    state.current = 'idle';
  };
  // Lost capture or cancel: never leave the desk moving, never nudge.
  const cancel = () => {
    window.clearTimeout(timer.current);
    if (state.current === 'holding') onStop();
    state.current = 'idle';
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const key = (e: KeyboardEvent, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat) return;
    if (down) start();
    else end();
  };
  const name = dir === 'up' ? 'Raise' : 'Lower';
  return (
    <button
      className={`desk-hold ${active ? 'active' : ''}`}
      disabled={disabled}
      aria-label={onTap ? `${name}: tap to nudge, hold to move` : `${name} (hold)`}
      title={onTap ? 'Tap to nudge 1 cm, hold to move' : 'Hold to move'}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => key(e, true)}
      onKeyUp={(e) => key(e, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon name={dir === 'up' ? 'raise' : 'lower'} size={30} />
    </button>
  );
}

function MoveButtons({ ids, live }: { ids: DeskIds; live: DeskLive }) {
  const hass = useHass();
  if (!ids.cover && !ids.nudgeUp) return null;
  const press = (id: string) => hass.callService('button', 'press', {}, { entity_id: id });
  const cover = (service: string) => ids.cover && hass.callService('cover', service, {}, { entity_id: ids.cover });
  const stop = () => (ids.stop ? press(ids.stop) : cover('stop_cover'));
  // Holding without a cover: keep nudging.
  const hold = (dir: 'up' | 'down') => (ids.cover ? cover(dir === 'up' ? 'open_cover' : 'close_cover') : press((dir === 'up' ? ids.nudgeUp : ids.nudgeDown)!));
  return (
    <div className="desk-move" data-no-swipe>
      <HoldButton
        dir="up"
        disabled={live.offline || (live.height ?? 0) >= live.max}
        active={live.moving === 'up'}
        onTap={ids.nudgeUp ? () => press(ids.nudgeUp!) : undefined}
        onStart={() => hold('up')}
        onStop={stop}
      />
      <button className={`desk-stop ${live.moving ? 'show' : ''}`} onClick={stop} aria-label="Stop" disabled={!live.moving}>
        <Icon name="stop" size={24} />
      </button>
      <HoldButton
        dir="down"
        disabled={live.offline || (live.height ?? 999) <= live.min}
        active={live.moving === 'down'}
        onTap={ids.nudgeDown ? () => press(ids.nudgeDown!) : undefined}
        onStart={() => hold('down')}
        onStop={stop}
      />
    </div>
  );
}

/* ---------- presets ---------- */

const ROLE_ICON: Record<string, IconName> = { sit: 'chair', stand: 'standing' };

function Presets({ ids, live, presets }: { ids: DeskIds; live: DeskLive; presets: ReturnType<typeof usePresetHeights> }) {
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!saving) return;
    const t = window.setTimeout(() => setSaving(false), 10_000);
    return () => window.clearTimeout(t);
  }, [saving]);
  if (!ids.presets.length) return null;
  const canSave = ids.presets.some((p) => p.set);
  return (
    <section className="desk-card">
      <header className="desk-card-head">
        <h3 className="label">Presets</h3>
        {canSave && (
          <button className={`v-btn small ${saving ? 'armed' : ''}`} onClick={() => setSaving(!saving)} disabled={live.offline || !!live.moving}>
            <Icon name="save" size={16} />
            {saving ? 'Cancel' : 'Save height'}
          </button>
        )}
      </header>
      {saving && <p className="desk-hint">Pick the key to save {displayHeight(live.height)} cm to.</p>}
      <div className="desk-presets">
        {ids.presets.map((p) => {
          const h = presets.heights[p.key];
          const here = h !== undefined && live.height !== undefined && Math.abs(h - live.height) < 0.6 && !live.moving;
          const icon = p.role && ROLE_ICON[p.role];
          return (
            <button
              key={p.key}
              className={`desk-preset ${here ? 'here' : ''} ${saving ? 'saving' : ''}`}
              disabled={live.offline || (saving && !p.set)}
              title={`M${p.slot}`}
              onClick={() => {
                if (saving) {
                  presets.save(p.key);
                  setSaving(false);
                } else presets.go(p.key);
              }}
            >
              <span className="desk-preset-name">
                {icon ? <Icon name={icon} size={20} /> : <span className="desk-preset-num">{p.label}</span>}
                {icon && p.label}
                {icon && <span className="desk-preset-slot">M{p.slot}</span>}
              </span>
              <span className="desk-preset-h">{saving ? `Save ${displayHeight(live.height)}` : h !== undefined ? `${h.toFixed(1)} cm` : 'Not learned yet'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- today and this week ---------- */

const DAY = 86_400_000;

// The height over the last 24 hours as a step line, with the standing band shaded.
function HeightChart({ points, min, max, line }: { points: HistoryPoint[]; min: number; max: number; line: number }) {
  const now = useNow(60_000).getTime();
  const W = 600;
  const H = 120;
  const from = now - DAY;
  const lo = Math.min(min, ...points.map((p) => p.v)) - 2;
  const hi = Math.max(max, ...points.map((p) => p.v)) + 2;
  const x = (t: number) => ((Math.max(t, from) - from) / DAY) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const visible = points.filter((p, i) => p.t >= from || (points[i + 1]?.t ?? now) > from);
  if (!visible.length) return <div className="spark-empty" style={{ height: H }} />;
  let d = `M ${x(visible[0].t)} ${y(visible[0].v)}`;
  for (let i = 1; i < visible.length; i++) d += ` H ${x(visible[i].t)} V ${y(visible[i].v)}`;
  d += ` H ${W}`;
  const ticks = [18, 12, 6].map((hAgo) => now - hAgo * 3600_000);
  return (
    <div className="desk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        <rect x="0" y="0" width={W} height={Math.max(0, y(line))} className="desk-chart-band" />
        <line x1="0" x2={W} y1={y(line)} y2={y(line)} className="desk-chart-line" vectorEffect="non-scaling-stroke" />
        {ticks.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1="0" y2={H} className="desk-chart-tick" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={d} className="desk-chart-path" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="desk-chart-axis">
        <span>24h ago</span>
        {ticks.map((t) => (
          <span key={t}>{new Date(t).toLocaleTimeString([], { hour: 'numeric' })}</span>
        ))}
        <span>Now</span>
      </div>
    </div>
  );
}

function Standing({ history, live, line }: { history: HistoryPoint[] | null; live: DeskLive; line: number }) {
  const now = useNow(60_000).getTime();
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const today = useMemo(() => (history ? postureStats(history, midnight, now, line) : null), [history, midnight, now, line]);
  const week = useMemo(() => (history ? dailyStanding(history, 7, now, line) : []), [history, now, line]);
  // When the current posture began (it may be before today).
  const since = useMemo(() => (history ? postureStats(history, now - 7 * DAY, now, line).since : undefined), [history, now, line]);
  const standing = isStanding(live.height, line);
  const peak = Math.max(...week.map((d) => d.standMs), 60 * 60_000);
  // How long at this height: the controller's idle counter (exact, ticking) when it has one, else the history.
  const atHeight = live.idle !== undefined ? fmtIdle(live.idle) : since ? fmtDuration(now - since) : history && history.length > 1 ? '7d+' : '–';
  return (
    <section className="desk-card">
      <header className="desk-card-head">
        <h3 className="label">Today</h3>
        <span className="panel-summary">standing from {Math.round(line)} cm</span>
      </header>
      {!today ? (
        <div className="spark-empty" style={{ height: 120 }} />
      ) : (
        <>
          <div className="stat-tiles desk-tiles">
            <div className="stat-tile">
              <div className="label">Standing</div>
              <div className="stat-val">{fmtDuration(today.standMs)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Stand-ups</div>
              <div className="stat-val">{today.standUps}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Longest stand</div>
              <div className="stat-val">{fmtDuration(today.longestStandMs)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">{live.moving ? 'Moving' : standing ? 'Standing for' : 'At sitting height for'}</div>
              <div className="stat-val">{atHeight}</div>
            </div>
          </div>
          <HeightChart points={history!} min={live.min} max={live.max} line={line} />
          <div className="desk-week" role="list" aria-label="Standing per day, last 7 days">
            {week.map((d, i) => (
              <div key={d.start} className={`desk-week-day ${i === week.length - 1 ? 'today' : ''}`} role="listitem" title={`${fmtDuration(d.standMs)} standing, ${d.standUps} stand-ups`}>
                <span className="desk-week-val">{d.standMs >= 60_000 ? fmtDuration(d.standMs) : ''}</span>
                <span className="desk-week-bar">
                  <i style={{ transform: `scaleY(${d.standMs / peak})` }} />
                </span>
                <span className="desk-week-name">{new Date(d.start).toLocaleDateString([], { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- the controller ---------- */

const signalText = (dbm: number) => `${dbm} dBm · ${dbm >= -55 ? 'Excellent' : dbm >= -67 ? 'Good' : dbm >= -75 ? 'Fair' : 'Weak'}`;
const ageText = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86_400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`);

// Uptime as a boot timestamp (newer firmware) or seconds.
function Uptime({ id }: { id: string }) {
  const e = useEntity(id);
  const now = useNow(60_000).getTime();
  if (!e || e.state === 'unavailable' || e.state === 'unknown') return null;
  const secs = e.attributes.device_class === 'timestamp' ? (now - Date.parse(e.state)) / 1000 : Number(e.state);
  if (!Number.isFinite(secs)) return null;
  return (
    <Row name="Controller up for">
      <span className="v-value">{ageText(secs)}</span>
    </Row>
  );
}

// A calibration number as a stepper with a sensible step (the controller's own
// steps can be 0.01 cm). Each tap sends the new value.
function Setting({ id, name }: { id: string; name: string }) {
  const hass = useHass();
  const e = useEntity(id);
  const v = num(e);
  if (!id.startsWith('number.')) return <EntityControl id={id} name={name} />;
  const a = e?.attributes ?? {};
  const unit = (a.unit_of_measurement as string | undefined) ?? '';
  const min = (a.min as number | undefined) ?? 0;
  const max = (a.max as number | undefined) ?? 100;
  const step = Math.max((a.step as number | undefined) ?? 1, unit === 'cm' ? 0.5 : unit === 'ms' ? 25 : 1);
  const set = (x: number) => hass.callService('number', 'set_value', { value: Math.round(Math.min(max, Math.max(min, x)) * 100) / 100 }, { entity_id: id });
  if (v === undefined) return <Row name={name} sub="Unavailable" />;
  return (
    <Row name={name}>
      <div className="v-stepper">
        <button className="round small" aria-label={`Less ${name}`} disabled={v <= min} onClick={() => set(v - step)}>
          <Icon name="minus" size={18} />
        </button>
        <span>
          {Number(v.toFixed(2))}
          {unit && <small> {unit}</small>}
        </span>
        <button className="round small" aria-label={`More ${name}`} disabled={v >= max} onClick={() => set(v + step)}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </Row>
  );
}

// What the calibration settings do, where the name alone doesn't say.
const SETTING_HINTS: Record<string, string> = {
  min_height: 'The bottom of the range the slider and arrows use',
  max_height: 'The top of the range the slider and arrows use',
  offset_up_by: 'Added when going up to a height, if it stops short',
  offset_down_by: 'Taken off when going down to a height',
};

function Controller({ ids }: { ids: DeskIds }) {
  const hass = useHass();
  const [open, setOpen] = useState(false);
  const [lock, idleOn, wifi] = useEntities([ids.childLock ?? '', ids.idleEnabled ?? '', ids.wifi ?? '']);
  const named = [...(ids.minHeight ? [ids.minHeight] : []), ...(ids.maxHeight ? [ids.maxHeight] : []), ...ids.settings];
  const settingEntities = useEntities(named);
  const extra = useEntities(ids.rest);
  const press = (id: string) => hass.callService('button', 'press', {}, { entity_id: id });
  // Strip the device's name from friendly names ("Desk Nudge Delay" → "Nudge Delay").
  const nameOf = (e: { attributes: Record<string, unknown> } | undefined, id: string) => ((e?.attributes.friendly_name as string | undefined) ?? id).replace(/^desk\s+/i, '');
  const keyOf = (id: string) => id.slice(id.indexOf('.') + 1 + ids.base.length + 1);
  const locked = lock?.state === 'on';
  return (
    <section className="desk-card">
      <header className="desk-card-head">
        <h3 className="label">Desk</h3>
      </header>
      {(ids.childLock || ids.childLockToggle) && (
        <Row name="Child lock" sub={locked ? 'The keypad is locked' : 'Locks the keypad'}>
          {ids.childLockToggle ? (
            <Toggle on={locked} disabled={!lock && !ids.childLockToggle} label="Child lock" onChange={() => press(ids.childLockToggle!)} />
          ) : (
            <Toggle on={locked} disabled={!lock || lock.state === 'unavailable'} label="Child lock" onChange={(on) => hass.callService('switch', on ? 'turn_on' : 'turn_off', {}, { entity_id: ids.childLock })} />
          )}
        </Row>
      )}
      {ids.idleEnabled && (
        <Row name="Idle counter" sub="Counts the time since the desk last moved">
          <Toggle on={idleOn?.state === 'on'} disabled={!idleOn || idleOn.state === 'unavailable'} label="Idle counter" onChange={(on) => hass.callService('switch', on ? 'turn_on' : 'turn_off', {}, { entity_id: ids.idleEnabled })} />
        </Row>
      )}
      {ids.idleReset && (
        <Row name="Reset idle timer">
          <button className="v-btn" onClick={() => press(ids.idleReset!)}>
            <Icon name="timer" size={18} />
            Reset
          </button>
        </Row>
      )}
      {wifi && num(wifi) !== undefined && (
        <Row name="Wi-Fi">
          <span className="v-value">{signalText(Math.round(num(wifi)!))}</span>
        </Row>
      )}
      {ids.uptime && <Uptime id={ids.uptime} />}
      {ids.firmware && <EntityControl id={ids.firmware} name="Firmware" />}
      {ids.rest.map((id, i) =>
        id.startsWith('sensor.') || id.startsWith('binary_sensor.') ? (
          <Row key={id} name={nameOf(extra[i], id)}>
            <span className="v-value">{sensorText(extra[i])}</span>
          </Row>
        ) : (
          <EntityControl key={id} id={id} name={nameOf(extra[i], id)} />
        ),
      )}
      {named.length > 0 && (
        <>
          <button className="desk-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="tune" size={18} />
            <span>Calibration</span>
            <Icon name={open ? 'up' : 'down'} size={18} />
          </button>
          {open &&
            named.map((id, i) => {
              const hint = SETTING_HINTS[keyOf(id)];
              return (
                <div key={id} className="desk-setting">
                  <Setting id={id} name={nameOf(settingEntities[i], id)} />
                  {hint && <small className="muted">{hint}</small>}
                </div>
              );
            })}
        </>
      )}
      {ids.restart && (
        <Row name="Restart controller">
          <ConfirmButton label="Restart" confirm="Sure?" icon="restart" onConfirm={() => press(ids.restart!)} />
        </Row>
      )}
    </section>
  );
}

/* ---------- the popup ---------- */

export function DeskDetail() {
  const hass = useHass();
  const ids = useDeskIds();
  const live = useDeskLive(ids);
  const presets = usePresetHeights(ids, live);
  const history = useDeskHistory(ids?.height ?? ids?.setHeight, live.height);
  const lock = useEntity(ids?.childLock);
  const [target, setTarget] = useState<number>();
  if (!ids) return <p className="muted">No desk found.</p>;
  const standing = isStanding(live.height, presets.line);

  const goTo = (cm: number) => {
    setTarget(undefined);
    if (ids.setHeight) hass.callService('number', 'set_value', { value: cm }, { entity_id: ids.setHeight });
    else if (ids.cover) hass.callService('cover', 'set_cover_position', { position: heightToPosition(cm, live.min, live.max) }, { entity_id: ids.cover });
  };

  return (
    <div className="desk-detail">
      <DeskStage live={live} target={target} standing={standing}>
        <MoveButtons ids={ids} live={live} />
      </DeskStage>
      {lock?.state === 'on' && (
        <div className="hold-banner desk-lock">
          <Icon name="childLock" size={18} />
          <span>
            <strong>Child lock is on.</strong> The keypad is locked.
          </span>
        </div>
      )}
      <div className="desk-cols">
        <div className="desk-col">
          {(ids.setHeight || ids.cover) && (
            <section className="desk-card">
              <header className="desk-card-head">
                <h3 className="label">Height</h3>
                <span className="panel-summary">
                  {live.min}–{live.max} cm
                </span>
              </header>
              <Slider
                className="desk-slider"
                label="Desk height"
                value={live.height ?? live.min}
                min={live.min}
                max={live.max}
                step={0.5}
                valueText={`${displayHeight(live.height)} cm`}
                onInput={setTarget}
                onCommit={goTo}
              >
                <span>
                  <Icon name="height" size={18} /> Go to
                </span>
                <span className="slider-value">{(target ?? live.height)?.toFixed(1) ?? '–'} cm</span>
              </Slider>
            </section>
          )}
          <Presets ids={ids} live={live} presets={presets} />
          <Controller ids={ids} />
        </div>
        <div className="desk-col">
          <Standing history={history} live={live} line={presets.line} />
        </div>
      </div>
    </div>
  );
}
