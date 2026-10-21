import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useHass } from '../ha/api';
import { useEntities, useEntity } from '../ha/store';
import { domainOf, isUnavailable, num } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';
import { useModal } from '../components/Modal';
import {
  consumables,
  fmtHours,
  fmtMinutes,
  parseHistory,
  parseSchedule,
  roomKey,
  sequenced,
  shortName,
  type VacRoom,
} from '../lib/vacuum';
import { ConfirmButton, EntityControl, Row, Section, sensorText } from './controls';
import { absUrl } from './useMapImage';
import type { VacuumInfo } from './useVacuum';

type Call = (domain: string, service: string, data?: Record<string, unknown>, what?: string) => Promise<unknown>;

const CLEANING = ['cleaning_mode', 'suction_level', 'water_volume', 'carpet_boost', 'carpet_sensitivity', 'customized_cleaning', 'cleaning_sequence', 'resume_cleaning', 'mop_cleaning_remainder'];
const DOCK = ['auto_dust_collecting', 'auto_empty_frequency', 'start_auto_empty', 'auto_empty_status', 'dust_collection', 'water_tank', 'charging_status'];
const CARE = ['clear_warning', 'maintenance', 'problem', 'error'];
const QUIET = ['dnd', 'dnd_start', 'dnd_end'];
const MAPS = ['selected_map', 'multi_floor_map', 'map_rotation', 'backup_saved_map', 'start_mapping', 'start_fast_mapping'];
const STATS = ['total_cleaned_area', 'total_cleaning_time', 'cleaning_count', 'first_cleaning_date'];
// Shown in the page header or used by the map; not repeated below.
const HEADER = ['battery_level', 'cleaning_time', 'cleaned_area', 'current_room', 'state', 'status', 'cleaning_history', 'mapping_time'];

// Buttons that change something lasting get a second tap.
const needsConfirm = (key: string) => /reset|mapping|delete|restore|backup/.test(key);

interface Props {
  info: VacuumInfo;
  device: string;
  vac: HassEntity | undefined;
  cam: HassEntity | undefined;
  rooms: VacRoom[];
  call: Call;
  onPickRoom: (id: number) => void;
}

export function VacuumSections({ info, device, vac, cam, rooms, call, onPickRoom }: Props) {
  const k = info.keys;
  const ids = useMemo(() => Object.values(k), [k]);
  const states = useEntities(ids);
  const byId = useMemo(() => new Map(ids.map((id, i) => [id, states[i]])), [ids, states]);
  const name = (key: string, id = k[key]) => shortName(byId.get(id)?.attributes.friendly_name as string | undefined, device, key);
  const has = (key: string) => !!k[key];
  const controls = (keys: string[]) =>
    keys.filter(has).map((key) => <EntityControl key={key} id={k[key]} name={name(key)} confirm={needsConfirm(key)} />);

  const keyList = useMemo(() => Object.entries(k).map(([key, id]) => ({ key, domain: domainOf(id) })), [k]);
  const parts = useMemo(() => consumables(keyList), [keyList]);

  // Everything not placed in a section above ends up in Settings or Diagnostics.
  const used = new Set([...CLEANING, ...DOCK, ...CARE, ...QUIET, ...MAPS, ...STATS, ...HEADER]);
  parts.forEach((p) => [p.percent, p.hours, p.reset].forEach((x) => x && used.add(x)));
  const rest = Object.entries(k)
    .filter(([key, id]) => !used.has(key) && !roomKey(key) && !id.startsWith('camera.'))
    .sort(([a], [b]) => a.localeCompare(b));
  const settings = rest.filter(([, id]) => /^(switch|select|number|time|button|input_\w+)\./.test(id));
  const diagnostics = rest.filter(([, id]) => /^(sensor|binary_sensor)\./.test(id));

  const attrs = (vac?.attributes ?? {}) as Record<string, unknown>;
  const camAttrs = (cam?.attributes ?? {}) as Record<string, unknown>;

  return (
    <>
      {CLEANING.some(has) && (
        <Section title="Cleaning" icon="broom" open>
          {controls(CLEANING)}
        </Section>
      )}

      {rooms.length > 0 && <RoomsSection info={info} device={device} rooms={rooms} call={call} onPickRoom={onPickRoom} byId={byId} />}

      {(DOCK.some(has) || parts.length > 0 || CARE.some(has)) && (
        <Section title="Dock & care" icon="dock" summary={<CareSummary parts={parts} keys={k} />}>
          {controls(DOCK)}
          {parts.map((p) => (
            <Consumable key={p.key} keys={k} part={p} name={name(p.percent!).replace(/ left$/i, '')} />
          ))}
          {controls(CARE)}
        </Section>
      )}

      {(QUIET.some(has) || Array.isArray(attrs.schedule)) && (
        <Section title="Quiet hours & schedule" icon="calendar">
          {controls(QUIET)}
          <Schedule value={attrs.schedule} rooms={rooms} />
        </Section>
      )}

      <MapsSection info={info} cam={cam} camAttrs={camAttrs} controls={controls(MAPS)} call={call} />

      <Section title="Remote control" icon="tune">
        <Remote call={call} svc={info.platform} />
      </Section>

      {(STATS.some(has) || has('cleaning_history')) && (
        <Section title="History" icon="history">
          <Stats keys={k} />
          <History id={k.cleaning_history} pictures={camAttrs.cleaning_history_picture} />
        </Section>
      )}

      {(settings.length > 0 || info.extra.length > 0) && (
        <Section title="Settings" icon="cog">
          {settings.map(([key, id]) => (
            <EntityControl key={key} id={id} name={name(key)} confirm={needsConfirm(key)} />
          ))}
          {info.extra
            .filter((id) => !id.startsWith('camera.'))
            .map((id) => (
              <EntityControl key={id} id={id} name={shortName(undefined, device, id.split('.')[1])} />
            ))}
        </Section>
      )}

      {diagnostics.length > 0 && (
        <Section title="Diagnostics" icon="alert">
          {diagnostics.map(([key, id]) => (
            <EntityControl key={key} id={id} name={name(key)} />
          ))}
        </Section>
      )}
    </>
  );
}

/* ---------- rooms ---------- */

function RoomsSection({
  info,
  device,
  rooms,
  call,
  onPickRoom,
  byId,
}: {
  info: VacuumInfo;
  device: string;
  rooms: VacRoom[];
  call: Call;
  onPickRoom: (id: number) => void;
  byId: Map<string, HassEntity | undefined>;
}) {
  const k = info.keys;
  const custom = useEntity(k.customized_cleaning);
  const [open, setOpen] = useState<number | null>(null);
  const [ordering, setOrdering] = useState<number[] | null>(null);
  const seq = sequenced(rooms);
  const hasOrder = rooms.some((r) => r.order > 0);
  const roomEntities = (id: number) =>
    Object.entries(k)
      .filter(([key]) => roomKey(key)?.room === id && roomKey(key)?.setting !== 'name')
      .sort(([a], [b]) => a.localeCompare(b));

  const move = (i: number, d: number) => {
    const list = [...(ordering ?? seq.map((r) => r.id))];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrdering(list);
  };

  return (
    <Section title="Rooms" icon="home" summary={`${rooms.length}`}>
      {custom && custom.state !== 'on' && roomEntities(rooms[0].id).length > 0 && (
        <p className="muted small vnote">Turn on {shortName(custom.attributes.friendly_name as string, device, 'customized_cleaning')} to give each room its own suction, water and passes.</p>
      )}
      {seq.map((r) => {
        const ents = roomEntities(r.id);
        const isOpen = open === r.id;
        return (
          <div key={r.id} className={`vroom ${isOpen ? 'open' : ''}`}>
            <div className="vroom-head">
              <button className="vroom-name" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen} disabled={!ents.length}>
                {r.order > 0 && <span className="count">{r.order}</span>}
                <span className="ellipsis">{r.name}</span>
                {ents.length > 0 && <Icon name={isOpen ? 'up' : 'down'} size={18} />}
              </button>
              <button className="chip-btn small" onClick={() => onPickRoom(r.id)} aria-label={`Show ${r.name} on the map`}>
                <Icon name="map" size={14} /> Map
              </button>
              <button className="chip-btn small" onClick={() => call(info.platform, 'vacuum_clean_segment', { segments: [r.id] }, `clean ${r.name}`)}>
                <Icon name="play" size={14} /> Clean
              </button>
            </div>
            {isOpen && (
              <div className="vroom-body">
                {ents.map(([key, id]) => (
                  <EntityControl
                    key={key}
                    id={id}
                    name={shortName(byId.get(id)?.attributes.friendly_name as string, device, key).replace(new RegExp(`\\s*${r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '')}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="vsub">
        <div className="vsub-head">
          <h3>Cleaning order</h3>
          {ordering ? (
            <>
              <button className="chip-btn small" onClick={() => setOrdering(null)}>
                Cancel
              </button>
              <button
                className="chip-btn small active"
                onClick={() => void call(info.platform, 'vacuum_set_cleaning_sequence', { cleaning_sequence: ordering }, 'save the order').then(() => setOrdering(null))}
              >
                Save
              </button>
            </>
          ) : (
            <>
              {hasOrder && (
                <ConfirmButton className="small" label="Clear" confirm="Clear?" onConfirm={() => call(info.platform, 'vacuum_set_cleaning_sequence', { cleaning_sequence: [] }, 'clear the order')} />
              )}
              <button className="chip-btn small" onClick={() => setOrdering(seq.map((r) => r.id))}>
                <Icon name="order" size={14} /> Change
              </button>
            </>
          )}
        </div>
        {ordering ? (
          <ol className="vorder">
            {ordering.map((id, i) => (
              <li key={id}>
                <span className="count">{i + 1}</span>
                <span className="grow ellipsis">{rooms.find((r) => r.id === id)?.name ?? id}</span>
                <button className="round small" aria-label="Earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" size={18} />
                </button>
                <button className="round small" aria-label="Later" disabled={i === ordering.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" size={18} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">{hasOrder ? seq.map((r) => r.name).join(' → ') : 'No set order: the robot picks its own route.'}</p>
        )}
      </div>
    </Section>
  );
}

/* ---------- dock & care ---------- */

function CareSummary({ parts, keys }: { parts: ReturnType<typeof consumables>; keys: Record<string, string> }) {
  const states = useEntities(parts.map((p) => keys[p.percent!]));
  const low = parts.filter((_, i) => (num(states[i]) ?? 100) <= 10).length;
  return <span className={low ? 'warn' : ''}>{low ? `${low} part${low > 1 ? 's' : ''} due` : parts.length ? 'All good' : ''}</span>;
}

function Consumable({ keys, part, name }: { keys: Record<string, string>; part: ReturnType<typeof consumables>[number]; name: string }) {
  const [pct, hrs] = useEntities([keys[part.percent!], part.hours ? keys[part.hours] : '']);
  const hass = useHass();
  const resetId = part.reset ? keys[part.reset] : undefined;
  const reset = useEntity(resetId);
  const p = num(pct);
  return (
    <div className="v-row vpart">
      <div className="v-row-name">
        <span>{name}</span>
        <small className="muted">
          {p !== undefined ? `${Math.round(p)}%` : sensorText(pct)}
          {num(hrs) !== undefined ? ` · ${fmtHours(num(hrs))} left` : ''}
        </small>
        <div className="progress">
          <i className={p !== undefined && p <= 10 ? 'low' : ''} style={{ width: `${p ?? 0}%` }} />
        </div>
      </div>
      {resetId && (
        <div className="v-row-ctl">
          <ConfirmButton
            label="Replaced"
            confirm="Reset?"
            disabled={!reset || reset.state === 'unavailable'}
            onConfirm={() => void hass.callService('button', 'press', {}, { entity_id: resetId })}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- schedule ---------- */

function Schedule({ value, rooms }: { value: unknown; rooms: VacRoom[] }) {
  const items = parseSchedule(value);
  if (!items.length) return null;
  return (
    <div className="vsub">
      <div className="vsub-head">
        <h3>Schedules</h3>
        <span className="muted small">Set in the vacuum's app</span>
      </div>
      {items.map((s) => (
        <Row
          key={s.id}
          name={s.time}
          sub={[
            s.days === 0 ? 'Once' : s.everyDay ? 'Every day' : `${s.days} day${s.days > 1 ? 's' : ''} a week`,
            s.rooms.length ? s.rooms.map((id) => rooms.find((r) => r.id === id)?.name ?? `Room ${id}`).join(', ') : 'Everywhere',
          ].join(' · ')}
        >
          <span className={`chip ${s.enabled ? 'ok' : ''}`}>{s.enabled ? 'On' : 'Off'}</span>
        </Row>
      ))}
    </div>
  );
}

/* ---------- maps ---------- */

function MapsSection({ info, cam, camAttrs, controls, call }: { info: VacuumInfo; cam: HassEntity | undefined; camAttrs: Record<string, unknown>; controls: ReactNode[]; call: Call }) {
  const modal = useModal();
  const selected = useEntity(info.keys.selected_map);
  const mapId = (selected?.attributes.map_id as number | undefined) ?? (camAttrs.saved_map_id as number | undefined);
  const mapName = selected && !isUnavailable(selected) ? selected.state : undefined;
  const [rename, setRename] = useState(mapName ?? '');
  useEffect(() => setRename(mapName ?? ''), [mapName]);
  const recovery = Object.entries((camAttrs.recovery_map_picture as Record<string, string> | undefined) ?? {})
    .map(([label, url]) => ({ label, url, index: Number(/[?&#]index=(\d+)/.exec(url)?.[1]) }))
    .filter((r) => Number.isFinite(r.index));
  const saved = useEntities(info.savedMaps);

  if (!cam && !controls.length) return null;
  return (
    <Section title="Maps" icon="map" summary={mapName}>
      {controls}
      {mapId !== undefined && (
        <Row name="Map name" className="wrap">
          <div className="vbar-row">
            <input className="v-input" aria-label="Map name" value={rename} maxLength={40} onChange={(e) => setRename(e.target.value)} />
            <button
              className="v-btn"
              disabled={!rename.trim() || rename.trim() === mapName}
              onClick={() => call(info.platform, 'vacuum_rename_map', { map_id: mapId, map_name: rename.trim() }, 'rename the map')}
            >
              Rename
            </button>
          </div>
        </Row>
      )}
      <Row name="Refresh the map" sub="Ask the vacuum for its latest map">
        <button className="v-btn" onClick={() => call(info.platform, 'vacuum_request_map', {}, 'refresh the map')}>
          <Icon name="refresh" size={18} />
          Refresh
        </button>
      </Row>
      {saved.some((s) => s?.attributes.entity_picture) && (
        <div className="vsub">
          <div className="vsub-head">
            <h3>Saved maps</h3>
          </div>
          <div className="vthumbs">
            {saved.map((s) =>
              s?.attributes.entity_picture ? (
                <button
                  key={s.entity_id}
                  className="vthumb"
                  onClick={() => modal.open({ title: String(s.attributes.map_name ?? s.attributes.friendly_name), icon: 'map', wide: true, body: <img className="vbig" src={absUrl(String(s.attributes.entity_picture))} alt="" /> })}
                >
                  <img src={absUrl(String(s.attributes.entity_picture))} alt="" loading="lazy" />
                  <span className="ellipsis">{String(s.attributes.map_name ?? '')}</span>
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}
      {recovery.length > 0 && mapId !== undefined && (
        <div className="vsub">
          <div className="vsub-head">
            <h3>Restore an earlier version</h3>
          </div>
          {recovery.map((r) => (
            <div key={r.index} className="v-row">
              <button
                className="vthumb small"
                onClick={() => modal.open({ title: r.label, icon: 'map', wide: true, body: <img className="vbig" src={absUrl(r.url)} alt="" /> })}
              >
                <img src={absUrl(r.url)} alt="" loading="lazy" />
              </button>
              <div className="v-row-name">
                <span className="ellipsis">{r.label.replace(/^[\d/: ]+:\s*/, '')}</span>
                <small className="muted">{r.label.split(': ')[0]}</small>
              </div>
              <div className="v-row-ctl">
                <ConfirmButton
                  icon="backup"
                  label="Restore"
                  confirm="Replace map?"
                  onConfirm={() => call(info.platform, 'vacuum_restore_map', { recovery_map_index: r.index, map_id: mapId }, 'restore the map')}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ---------- remote control ---------- */

const STEPS: { icon: IconName; label: string; rotation: number; velocity: number; area: string }[] = [
  { icon: 'arrowUp', label: 'Forward', rotation: 0, velocity: 200, area: 'up' },
  { icon: 'rotateLeft', label: 'Turn left', rotation: 90, velocity: 0, area: 'left' },
  { icon: 'rotateRight', label: 'Turn right', rotation: -90, velocity: 0, area: 'right' },
  { icon: 'arrowDown', label: 'Back', rotation: 0, velocity: -150, area: 'down' },
];

function Remote({ call, svc }: { call: Call; svc: string }) {
  return (
    <>
      <p className="muted small vnote">Each tap moves the robot one short step. Keep it in sight.</p>
      <div className="vremote">
        {STEPS.map((s) => (
          <button key={s.area} className="round" style={{ gridArea: s.area }} aria-label={s.label} onClick={() => call(svc, 'vacuum_remote_control_move_step', { rotation: s.rotation, velocity: s.velocity }, 'move it')}>
            <Icon name={s.icon} size={26} />
          </button>
        ))}
        <span className="vremote-mid" style={{ gridArea: 'mid' }}>
          <Icon name="vacuum" size={28} />
        </span>
      </div>
    </>
  );
}

/* ---------- history ---------- */

function Stats({ keys }: { keys: Record<string, string> }) {
  const [area, time, count, first] = useEntities(STATS.map((s) => keys[s] ?? ''));
  const tiles: [string, string][] = [];
  if (num(area) !== undefined) tiles.push(['Cleaned', `${Math.round(num(area)!).toLocaleString()} m²`]);
  if (num(time) !== undefined) tiles.push(['Time', fmtMinutes(num(time))]);
  if (num(count) !== undefined) tiles.push(['Runs', String(num(count))]);
  if (first && !isUnavailable(first)) {
    const t = new Date(first.state);
    if (Number.isFinite(t.getTime())) tiles.push(['Since', t.toLocaleDateString([], { month: 'short', year: 'numeric' })]);
  }
  if (!tiles.length) return null;
  return (
    <div className="vtiles">
      {tiles.map(([l, v]) => (
        <div key={l} className="vtile">
          <span className="label">{l}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}

function History({ id, pictures }: { id?: string; pictures: unknown }) {
  const modal = useModal();
  const e = useEntity(id);
  const runs = parseHistory(e?.attributes as Record<string, unknown> | undefined);
  const pics = Object.entries((pictures as Record<string, string> | undefined) ?? {});
  if (!runs.length && !pics.length) return null;
  // The camera labels its pictures "1: 08/10 13:44 - Cleaning (Completed)"; match runs by their "08-10 13:44" label.
  const picFor = (label: string) => pics.find(([k]) => k.includes(label.replace(/-/g, '/')))?.[1];
  return (
    <div className="vsub">
      <div className="vsub-head">
        <h3>Recent runs</h3>
      </div>
      {runs.length
        ? runs.slice(0, 20).map((r) => {
            const pic = picFor(r.label);
            return (
              <div key={r.label} className="v-row">
                {pic && (
                  <button className="vthumb small" onClick={() => modal.open({ title: r.label, icon: 'history', wide: true, body: <img className="vbig" src={absUrl(pic)} alt="" /> })}>
                    <img src={absUrl(pic)} alt="" loading="lazy" />
                  </button>
                )}
                <div className="v-row-name">
                  <span>{new Date(r.at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <small className="muted">
                    {[r.minutes !== undefined ? fmtMinutes(r.minutes) : '', r.area !== undefined ? `${r.area} m²` : '', r.status ?? ''].filter(Boolean).join(' · ')}
                  </small>
                </div>
                {r.completed !== undefined && <span className={`chip ${r.completed ? 'ok' : 'warn'}`}>{r.completed ? 'Done' : 'Stopped'}</span>}
              </div>
            );
          })
        : pics.map(([label, url]) => (
            <div key={label} className="v-row">
              <button className="vthumb small" onClick={() => modal.open({ title: label, icon: 'history', wide: true, body: <img className="vbig" src={absUrl(url)} alt="" /> })}>
                <img src={absUrl(url)} alt="" loading="lazy" />
              </button>
              <div className="v-row-name">
                <span>{label.replace(/^\d+:\s*/, '')}</span>
              </div>
            </div>
          ))}
    </div>
  );
}

