import { useEffect, useMemo, useState } from 'react';
import { useHass } from '../ha/api';
import { useEntities, useEntity } from '../ha/store';
import { isUnavailable, num } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';
import { useToasts } from '../components/Toasts';
import {
  calibration,
  commonPrefix,
  isRunning,
  optionIndex,
  parseRestrictions,
  parseRooms,
  restrictionsPayload,
  sameRestrictions,
  vacuumStatus,
  type Line,
  type Pt,
  type Rect,
  type Restrictions,
} from '../lib/vacuum';
import { ConfirmButton } from './controls';
import { BackButton, Cockpit, type VacParts } from './Cockpit';
import { useMapImage } from './useMapImage';
import { useVacuum, type VacuumInfo } from './useVacuum';
import { VacuumMap, type MapProps, type Shape, type ShapeKind } from './VacuumMap';
import { VacuumSections } from './VacuumSections';

type Mode = 'rooms' | 'zones' | 'spot' | 'restrict' | 'edit';
type Tool = 'noGo' | 'noMop' | 'wall';

const MODES: { id: Mode; label: string; icon: IconName }[] = [
  { id: 'rooms', label: 'Rooms', icon: 'home' },
  { id: 'zones', label: 'Zones', icon: 'zone' },
  { id: 'spot', label: 'Spot', icon: 'spot' },
  { id: 'restrict', label: 'No-go', icon: 'noGo' },
  { id: 'edit', label: 'Edit rooms', icon: 'pencil' },
];

const TOOLS: { id: Tool; label: string; icon: IconName; shape: 'rect' | 'line' }[] = [
  { id: 'noGo', label: 'No-go zone', icon: 'noGo', shape: 'rect' },
  { id: 'noMop', label: 'No-mop zone', icon: 'noMop', shape: 'rect' },
  { id: 'wall', label: 'Virtual wall', icon: 'wall', shape: 'line' },
];

const MAX_ZONES = 10;

export interface CleanOpts {
  repeats: number;
  suction?: number; // 0-based position in the suction list
  water?: number; // 1-based (the services count water from 1)
}

// The robot vacuum page: status and controls, the live map (pick rooms, draw
// zones, pick a spot, edit no-go zones and walls, rename/merge/split rooms),
// and every setting the vacuum's integration exposes.
export function VacuumPage({ onBack }: { onBack?: () => void }) {
  const info = useVacuum();
  if (!info.id) {
    return (
      <div className="vpage">
        <section className="panel vpage-none">
          {onBack && <BackButton onBack={onBack} />}
          <Icon name="vacuum" size={40} />
          <p className="muted">No robot vacuum found in Home Assistant.</p>
        </section>
      </div>
    );
  }
  return <Vacuum info={info} onBack={onBack} />;
}


function Vacuum({ info, onBack }: { info: VacuumInfo; onBack?: () => void }) {
  const hass = useHass();
  const toasts = useToasts();
  const vac = useEntity(info.id);
  const cam = useEntity(info.map);
  const k = info.keys;
  const [suctionSel, waterSel, modeSel, roomSensor, batterySensor] = useEntities([k.suction_level, k.water_volume, k.cleaning_mode, k.current_room, k.battery_level].map((x) => x ?? ''));
  const allIds = useMemo(() => Object.values(k), [k]);
  const siblings = useEntities(allIds);
  const device = useMemo(
    () => commonPrefix(siblings.map((s) => (s?.attributes.friendly_name as string | undefined) ?? '')),
    // Names rarely change; recompute when the set of entities does.
    [allIds], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const attrs = (vac?.attributes ?? {}) as Record<string, unknown>;
  const camAttrs = (cam?.attributes ?? {}) as Record<string, unknown>;
  const cal = useMemo(() => calibration(camAttrs.calibration_points), [JSON.stringify(camAttrs.calibration_points)]); // eslint-disable-line react-hooks/exhaustive-deps
  const rooms = useMemo(() => parseRooms(camAttrs.rooms), [JSON.stringify(camAttrs.rooms)]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = useMemo(
    () => parseRestrictions(camAttrs),
    [JSON.stringify([camAttrs.virtual_walls, camAttrs.no_go_areas, camAttrs.no_mopping_areas])], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const map = useMapImage(cam?.attributes.entity_picture as string | undefined, rooms, cal);

  const status = vacuumStatus(vac?.state, attrs);
  const running = isRunning(vac?.state);
  const paused = vac?.state === 'paused';
  const battery = num(batterySensor) ?? (typeof attrs.battery === 'number' ? attrs.battery : (attrs.battery_level as number | undefined));
  const offline = isUnavailable(vac);
  const svc = info.platform;
  const target = { entity_id: info.id };

  const call = (domain: string, service: string, data: Record<string, unknown> = {}, what?: string) =>
    hass.callService(domain, service, data, target).catch((err: unknown) => {
      toasts.push({ id: `vac-${service}-${Date.now()}`, title: what ? `Couldn't ${what}` : 'Vacuum command failed', text: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err), icon: 'alert', tone: 'warn' });
    });

  /* ---------- map state ---------- */
  const [mode, setMode] = useState<Mode>('rooms');
  const [picked, setPicked] = useState<number[]>([]);
  const [zones, setZones] = useState<Rect[]>([]);
  const [point, setPoint] = useState<Pt | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Restrictions | null>(null);
  const [tool, setTool] = useState<Tool>('noGo');
  const [editPick, setEditPick] = useState<number[]>([]);
  const [split, setSplit] = useState<Line | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [opts, setOpts] = useState<CleanOpts>({ repeats: 1 });

  const restr = draft ?? saved;
  const dirty = !!draft && !sameRestrictions(draft, saved);
  // Drop picks of rooms that no longer exist (after a merge or split).
  useEffect(() => {
    const ids = new Set(rooms.map((r) => r.id));
    setPicked((p) => (p.every((id) => ids.has(id)) ? p : p.filter((id) => ids.has(id))));
    setEditPick((p) => (p.every((id) => ids.has(id)) ? p : p.filter((id) => ids.has(id))));
  }, [rooms]);
  useEffect(() => setActive(null), [mode]);

  const shapes: Shape[] = useMemo(() => {
    if (mode === 'zones') return zones.map((rect, i) => ({ id: `zone-${i}`, kind: 'zone', rect, label: `Zone ${i + 1}`, editable: true }));
    if (mode === 'restrict')
      return [
        ...restr.noGo.map((rect, i): Shape => ({ id: `noGo-${i}`, kind: 'noGo', rect, editable: true })),
        ...restr.noMop.map((rect, i): Shape => ({ id: `noMop-${i}`, kind: 'noMop', rect, editable: true })),
        ...restr.walls.map((line, i): Shape => ({ id: `wall-${i}`, kind: 'wall', line, editable: true })),
      ];
    if (mode === 'edit' && split) return [{ id: 'split', kind: 'split', line: split, editable: true }];
    return [];
  }, [mode, zones, restr, split]);

  const parseId = (id: string): [ShapeKind, number] => {
    const [kind, i] = id.split('-');
    return [kind as ShapeKind, Number(i)];
  };
  const editRestr = (fn: (r: Restrictions) => Restrictions) => setDraft((d) => fn(d ?? saved));
  const listOf = (kind: ShapeKind): keyof Restrictions => (kind === 'wall' ? 'walls' : kind === 'noMop' ? 'noMop' : 'noGo');

  const onDraw = (s: Shape) => {
    if (mode === 'zones' && s.rect) {
      if (zones.length >= MAX_ZONES) return;
      setZones([...zones, s.rect]);
      setActive(`zone-${zones.length}`);
    } else if (mode === 'restrict') {
      const key = listOf(tool);
      const value = tool === 'wall' ? s.line : s.rect;
      if (!value) return;
      editRestr((r) => ({ ...r, [key]: [...(r[key] as unknown[]), value] }));
      setActive(`${tool}-${restr[key].length}`);
    } else if (mode === 'edit' && s.line) {
      setSplit(s.line);
      setActive('split');
    }
  };
  const onChange = (s: Shape) => {
    if (s.id === 'split') return setSplit(s.line ?? null);
    const [kind, i] = parseId(s.id);
    if (kind === 'zone' && s.rect) setZones(zones.map((z, j) => (j === i ? s.rect! : z)));
    else editRestr((r) => ({ ...r, [listOf(kind)]: (r[listOf(kind)] as unknown[]).map((v, j) => (j === i ? (kind === 'wall' ? s.line : s.rect) : v)) }));
  };
  const onDelete = (id: string) => {
    setActive(null);
    if (id === 'split') return setSplit(null);
    const [kind, i] = parseId(id);
    if (kind === 'zone') setZones(zones.filter((_, j) => j !== i));
    else editRestr((r) => ({ ...r, [listOf(kind)]: (r[listOf(kind)] as unknown[]).filter((_, j) => j !== i) }));
  };

  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const onRoomTap =
    mode === 'rooms'
      ? (id: number) => setPicked((p) => toggle(p, id))
      : mode === 'edit' && !splitting
        ? (id: number) => setEditPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)))
        : undefined;

  // Clean options: current suction / water selects unless changed here.
  const suctionOpts = (suctionSel?.attributes.options as string[] | undefined) ?? (attrs.fan_speed_list as string[] | undefined) ?? [];
  const waterOpts = (waterSel?.attributes.options as string[] | undefined) ?? [];
  const suction = opts.suction ?? optionIndex(suctionOpts, suctionSel?.state);
  const water = opts.water ?? ((optionIndex(waterOpts, waterSel?.state) ?? -1) + 1 || undefined);
  const mops = !modeSel || !/^sweeping$/i.test(modeSel.state);
  const extra = () => ({
    repeats: opts.repeats,
    ...(suction !== undefined ? { suction_level: suction } : {}),
    ...(water !== undefined && mops && waterOpts.length ? { water_volume: water } : {}),
  });

  const startRooms = () =>
    picked.length ? call(svc, 'vacuum_clean_segment', { segments: picked, ...extra() }, 'start the room clean') : call('vacuum', 'start', {}, 'start cleaning');
  const startZones = () =>
    call(svc, 'vacuum_clean_zone', { zone: zones.map((z) => z.map(Math.round)), ...extra() }, 'start the zone clean');
  const saveRestrictions = () => {
    if (!draft) return;
    void call(svc, 'vacuum_set_restricted_zone', restrictionsPayload(draft), 'save the no-go zones').then(() => {
      setDraft(null);
      setActive(null);
    });
  };

  const sel = (id: number) => rooms.find((r) => r.id === id);
  const name = device || (vac?.attributes.friendly_name as string | undefined) || 'Vacuum';
  const currentRoom = roomSensor && !isUnavailable(roomSensor) ? roomSensor.state : undefined;

  const primary = running
    ? { icon: 'pause' as IconName, label: 'Pause', onClick: () => void call('vacuum', 'pause', {}, 'pause'), disabled: false }
    : { icon: 'play' as IconName, label: paused ? 'Resume' : 'Start', onClick: () => void call('vacuum', 'start', {}, 'start cleaning'), disabled: offline };
  const secondary = [
    { icon: 'stop' as IconName, label: 'Stop', onClick: () => void call('vacuum', 'stop', {}, 'stop'), disabled: !running && !paused },
    { icon: 'dock' as IconName, label: 'Dock', onClick: () => void call('vacuum', 'return_to_base', {}, 'send it to the dock'), disabled: offline || vac?.state === 'docked' },
    { icon: 'locate' as IconName, label: 'Find', onClick: () => void call('vacuum', 'locate', {}, 'locate it'), disabled: offline },
  ];

  const modeTabs = (
    <div className="segmented small vmodes" role="tablist">
      {MODES.map((m) => (
        <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
          <Icon name={m.icon} size={18} />
          <span>{m.label}</span>
          {m.id === 'restrict' && dirty && <i className="vmode-dot" aria-label="unsaved" />}
        </button>
      ))}
    </div>
  );

  const mapEl = (x: Partial<MapProps> = {}) => (
    <VacuumMap
      map={map}
      cal={cal}
      rooms={rooms}
      robot={camAttrs.vacuum_position as Pt | undefined}
      running={running || paused}
      selected={mode === 'rooms' ? picked : mode === 'edit' ? editPick : []}
      dimOthers={mode === 'edit' && editPick.length > 0}
      onRoomTap={onRoomTap}
      shapes={shapes}
      active={active}
      onSelect={setActive}
      onChange={onChange}
      onDelete={onDelete}
      draw={
        mode === 'zones'
          ? zones.length < MAX_ZONES ? { kind: 'zone', shape: 'rect' } : null
          : mode === 'restrict'
            ? { kind: tool, shape: TOOLS.find((t) => t.id === tool)!.shape }
            : mode === 'edit' && splitting
              ? { kind: 'split', shape: 'line' }
              : null
      }
      onDraw={onDraw}
      point={mode === 'spot' ? point : null}
      onPoint={mode === 'spot' ? setPoint : undefined}
      {...x}
    />
  );

  const cleanOptions = <CleanOptions opts={opts} setOpts={setOpts} suctionOpts={suctionOpts} waterOpts={mops ? waterOpts : []} suction={suction} water={water} />;

  const bar = (
    <>
      {!cal && <p className="muted small">This vacuum's map has no calibration, so rooms and zones can't be picked on it.</p>}

      {mode === 'rooms' && (
        <>
          <div className="vpicks">
            {picked.length ? (
              picked.map((id, i) => (
                <button key={id} className="chip-btn small active" onClick={() => setPicked(picked.filter((x) => x !== id))}>
                  {i + 1}. {sel(id)?.name ?? id} <Icon name="close" size={14} />
                </button>
              ))
            ) : (
              <span className="muted small">Tap rooms on the map, in the order to clean them. Nothing picked cleans everywhere.</span>
            )}
          </div>
          <div className="vbar-row">
            <button className="chip-btn small" onClick={() => setPicked(picked.length === rooms.length ? [] : rooms.map((r) => r.id))} disabled={!rooms.length}>
              {picked.length === rooms.length && rooms.length ? 'None' : 'All rooms'}
            </button>
            {cleanOptions}
            <button className="v-btn primary" onClick={startRooms} disabled={offline}>
              <Icon name="play" size={18} />
              {picked.length ? `Clean ${picked.length} room${picked.length > 1 ? 's' : ''}` : 'Clean everywhere'}
            </button>
          </div>
        </>
      )}

      {mode === 'zones' && (
        <>
          <p className="muted small">Drag on the map to draw a zone (up to {MAX_ZONES}). Tap a zone to move, resize or delete it; two fingers pan and zoom.</p>
          <div className="vbar-row">
            <button className="chip-btn small" onClick={() => setZones([])} disabled={!zones.length}>
              Clear
            </button>
            {cleanOptions}
            <button className="v-btn primary" onClick={startZones} disabled={offline || !zones.length}>
              <Icon name="play" size={18} />
              {zones.length ? `Clean ${zones.length} zone${zones.length > 1 ? 's' : ''}` : 'Clean zones'}
            </button>
          </div>
        </>
      )}

      {mode === 'spot' && (
        <>
          <p className="muted small">{point ? 'Spot picked. Clean around it, or send the robot there.' : 'Tap the map to pick a spot.'}</p>
          <div className="vbar-row">
            {cleanOptions}
            <button className="v-btn" disabled={!point || offline} onClick={() => point && call(svc, 'vacuum_goto', { x: Math.round(point.x), y: Math.round(point.y) }, 'send it there')}>
              <Icon name="path" size={18} />
              Go here
            </button>
            <button
              className="v-btn primary"
              disabled={!point || offline}
              onClick={() => point && call(svc, 'vacuum_clean_spot', { points: [[Math.round(point.x), Math.round(point.y)]], ...extra() }, 'start the spot clean')}
            >
              <Icon name="spot" size={18} />
              Spot clean
            </button>
          </div>
        </>
      )}

      {mode === 'restrict' && (
        <>
          <div className="vbar-row">
            <div className="v-choice" role="radiogroup" aria-label="Draw">
              {TOOLS.map((t) => (
                <button key={t.id} role="radio" aria-checked={tool === t.id} className={`tool-${t.id} ${tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)}>
                  <Icon name={t.icon} size={16} /> {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            {tool === 'wall' ? 'Drag to draw a wall the robot won’t cross.' : `Drag to draw a ${tool === 'noGo' ? 'zone the robot stays out of' : 'zone it vacuums but never mops'}.`}{' '}
            Tap one to move, resize or delete it. {restr.noGo.length} no-go · {restr.noMop.length} no-mop · {restr.walls.length} wall{restr.walls.length === 1 ? '' : 's'}
            {dirty ? ' · not saved yet' : ''}
          </p>
          <div className="vbar-row end">
            <button className="v-btn" disabled={!draft} onClick={() => (setDraft(null), setActive(null))}>
              <Icon name="undo" size={18} />
              Discard
            </button>
            <button className="v-btn primary" disabled={!dirty || offline} onClick={saveRestrictions}>
              <Icon name="save" size={18} />
              Save to vacuum
            </button>
          </div>
        </>
      )}

      {mode === 'edit' && (
        <RoomEditBar
          svc={svc}
          call={call}
          picked={editPick.map(sel).filter((r): r is NonNullable<typeof r> => !!r)}
          split={split}
          splitting={splitting}
          setSplitting={(v) => {
            setSplitting(v);
            setSplit(null);
            setActive(null);
          }}
          done={() => {
            setEditPick([]);
            setSplit(null);
            setSplitting(false);
          }}
          nameSelect={editPick.length === 1 ? k[`room_${editPick[0]}_name`] : undefined}
        />
      )}
    </>
  );

  const parts: VacParts = {
    onBack,
    name,
    status,
    statusLine: `${status.label}${currentRoom && (running || paused) ? ` · ${currentRoom}` : ''}`,
    battery,
    running,
    paused,
    offline,
    currentRoom,
    keys: k,
    vac,
    primary,
    secondary,
    modeTabs,
    map: mapEl,
    bar,
    sections: (only, flat) => (
      <VacuumSections info={info} device={device} vac={vac} cam={cam} rooms={rooms} call={call} only={only} flat={flat} onPickRoom={(id) => (setMode('rooms'), setPicked([id]))} />
    ),
    rooms,
    picked,
    togglePick: (id) => setPicked((p) => toggle(p, id)),
    setPicked,
    startRooms,
    showMap: () => setMode('rooms'),
  };

  return <Cockpit p={parts} />;
}

const REPEATS = [1, 2, 3];

export function CleanOptions({
  opts,
  setOpts,
  suctionOpts,
  waterOpts,
  suction,
  water,
}: {
  opts: CleanOpts;
  setOpts: (o: CleanOpts) => void;
  suctionOpts: string[];
  waterOpts: string[];
  suction?: number;
  water?: number;
}) {
  return (
    <div className="vopts">
      <label className="vopt">
        <span>Passes</span>
        <select value={opts.repeats} onChange={(e) => setOpts({ ...opts, repeats: Number(e.target.value) })}>
          {REPEATS.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </label>
      {suctionOpts.length > 0 && (
        <label className="vopt">
          <span>Suction</span>
          <select value={suction ?? ''} onChange={(e) => setOpts({ ...opts, suction: Number(e.target.value) })}>
            {suctionOpts.map((o, i) => (
              <option key={o} value={i}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )}
      {waterOpts.length > 0 && (
        <label className="vopt">
          <span>Water</span>
          <select value={water ?? ''} onChange={(e) => setOpts({ ...opts, water: Number(e.target.value) })}>
            {waterOpts.map((o, i) => (
              <option key={o} value={i + 1}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

type Call = (domain: string, service: string, data?: Record<string, unknown>, what?: string) => Promise<unknown>;

function RoomEditBar({
  svc,
  call,
  picked,
  split,
  splitting,
  setSplitting,
  done,
  nameSelect,
}: {
  svc: string;
  call: Call;
  picked: { id: number; name: string }[];
  split: Line | null;
  splitting: boolean;
  setSplitting: (v: boolean) => void;
  done: () => void;
  nameSelect?: string;
}) {
  const one = picked.length === 1 ? picked[0] : undefined;
  const [name, setName] = useState(one?.name ?? '');
  useEffect(() => setName(one?.name ?? ''), [one?.id, one?.name]);
  const preset = useEntity(nameSelect);
  const presets = ((preset?.attributes.options as string[] | undefined) ?? []).filter((o) => o !== 'unavailable');
  // No map_id: the integration then edits the selected map. (The camera's map_id is a frame id, not a saved map.)

  if (splitting && one)
    return (
      <>
        <p className="muted small">Draw a line across {one.name} where it should be divided. Drag its ends to adjust.</p>
        <div className="vbar-row end">
          <button className="v-btn" onClick={() => setSplitting(false)}>
            Cancel
          </button>
          <ConfirmButton
            className="primary"
            icon="split"
            label={`Split ${one.name}`}
            confirm="Tap again to split"
            disabled={!split}
            onConfirm={() =>
              void call(svc, 'vacuum_split_segments', { segment: one.id, line: split!.map(Math.round) }, 'split the room').then(done)
            }
          />
        </div>
      </>
    );

  if (picked.length === 2)
    return (
      <>
        <p className="muted small">
          Merge {picked[0].name} and {picked[1].name} into one room. They must share a wall.
        </p>
        <div className="vbar-row end">
          <button className="v-btn" onClick={done}>
            Cancel
          </button>
          <ConfirmButton
            className="primary"
            icon="merge"
            label="Merge rooms"
            confirm="Tap again to merge"
            onConfirm={() => void call(svc, 'vacuum_merge_segments', { segments: picked.map((p) => p.id) }, 'merge the rooms').then(done)}
          />
        </div>
      </>
    );

  if (one)
    return (
      <>
        <div className="vbar-row">
          <input className="v-input" value={name} aria-label="Room name" maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button
            className="v-btn primary"
            disabled={!name.trim() || name.trim() === one.name}
            onClick={() => call(svc, 'vacuum_rename_segment', { segment_id: one.id, segment_name: name.trim() }, 'rename the room')}
          >
            <Icon name="save" size={18} />
            Rename
          </button>
        </div>
        {presets.length > 0 && (
          <div className="vpicks">
            {presets.slice(0, 16).map((p) => (
              <button key={p} className={`chip-btn small ${p === one.name ? 'active' : ''}`} onClick={() => setName(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="vbar-row end">
          <span className="muted small grow">Tap a neighbouring room too to merge them.</span>
          <button className="v-btn" onClick={() => setSplitting(true)}>
            <Icon name="split" size={18} />
            Split…
          </button>
        </div>
      </>
    );

  return <p className="muted small">Tap a room to rename or split it. Tap two neighbouring rooms to merge them.</p>;
}

