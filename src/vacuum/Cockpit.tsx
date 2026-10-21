import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { VACUUM } from '../config/entities';
import { useEntities } from '../ha/store';
import { domainOf, num } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';
import { consumables, sequenced, type Tone, type VacRoom } from '../lib/vacuum';
import { RobotViewer } from './robot3d';
import type { MapProps } from './VacuumMap';
import type { SectionId } from './VacuumSections';

// The vacuum page's layout ("Cockpit", the owner's pick over a classic
// map-and-sidebar page and a full-screen map): a hero with the robot in 3D,
// its numbers, controls and wear rings on the left; tabs on the right (the map
// with its modes, rooms, cleaning, care, history, more). VacuumPage builds the
// parts; this arranges them.

export interface Ctl {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface VacParts {
  onBack?: () => void;
  name: string;
  status: { label: string; tone: Tone };
  statusLine: string;
  battery?: number;
  running: boolean;
  paused: boolean;
  offline: boolean;
  currentRoom?: string;
  keys: Record<string, string>;
  vac: HassEntity | undefined;
  primary: Ctl;
  secondary: Ctl[];
  modeTabs: ReactNode;
  map: (extra?: Partial<MapProps>) => ReactNode;
  bar: ReactNode;
  sections: (only?: SectionId[], flat?: boolean) => ReactNode;
  rooms: VacRoom[];
  picked: number[];
  togglePick: (id: number) => void;
  setPicked: (ids: number[]) => void;
  startRooms: () => void;
  showMap: () => void;
}

export function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="round vpage-back" onClick={onBack} aria-label="Back to the dashboard">
      <Icon name="back" size={24} />
    </button>
  );
}

function CtlButton({ icon, label, onClick, primary, disabled }: Ctl & { primary?: boolean }) {
  return (
    <button className={`vctl ${primary ? 'primary' : ''}`} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={24} />
      <span>{label}</span>
    </button>
  );
}

type Tab = 'map' | 'rooms' | 'cleaning' | 'care' | 'history' | 'more';
const TABS: { id: Tab; label: string; icon: IconName; sections?: SectionId[] }[] = [
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'rooms', label: 'Rooms', icon: 'home', sections: ['rooms'] },
  { id: 'cleaning', label: 'Cleaning', icon: 'broom', sections: ['cleaning', 'quiet'] },
  { id: 'care', label: 'Care', icon: 'dock', sections: ['care'] },
  { id: 'history', label: 'History', icon: 'history', sections: ['history'] },
  { id: 'more', label: 'More', icon: 'cog', sections: ['maps', 'remote', 'settings', 'diagnostics'] },
];

export function Cockpit({ p }: { p: VacParts }) {
  const [tab, setTab] = useState<Tab>('map');
  const t = TABS.find((x) => x.id === tab)!;
  const emptying = useEmptying(p);
  return (
    <div className="vpage vcock">
      <section className="panel vcock-hero">
        <div className="vcock-hero-top">
          {p.onBack && <BackButton onBack={p.onBack} />}
          <div className="vpage-title">
            <h1 className="ellipsis">{p.name}</h1>
            <div className={`vpage-status ${p.status.tone}`}>
              <span className="dot" />
              <span className="ellipsis">{p.statusLine}</span>
            </div>
          </div>
        </div>
        <RobotHero battery={p.battery} state={p.vac?.state} tone={p.status.tone} emptying={emptying} />
        <HeroStats p={p} />
        <div className="vcock-controls">
          <CtlButton {...p.primary} primary />
          {p.secondary.map((c) => (
            <CtlButton key={c.label} {...c} />
          ))}
        </div>
        <Parts keys={p.keys} />
      </section>
      <section className="panel vcock-main">
        <div className="segmented vcock-tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
              <Icon name={x.icon} size={18} />
              <span>{x.label}</span>
            </button>
          ))}
        </div>
        {tab === 'map' ? (
          <div className="vcock-map">
            {p.modeTabs}
            {p.map()}
            <div className="vmap-bar">{p.bar}</div>
          </div>
        ) : (
          <div className="vcock-body">
            {tab === 'rooms' && <RoomTiles p={{ ...p, showMap: () => (setTab('map'), p.showMap()) }} />}
            {p.sections(t.sections, true)}
          </div>
        )}
      </section>
    </div>
  );
}

function HeroStats({ p }: { p: VacParts }) {
  const [time, area, total, runs] = useEntities([p.keys.cleaning_time ?? '', p.keys.cleaned_area ?? '', p.keys.total_cleaned_area ?? '', p.keys.cleaning_count ?? '']);
  const busy = p.running || p.paused;
  const tiles: [IconName, string, string][] = busy
    ? [
        ['timer', 'Time', num(time) !== undefined ? `${Math.round(num(time)!)} min` : '–'],
        ['zone', 'Cleaned', num(area) !== undefined ? `${Math.round(num(area)!)} m²` : '–'],
        ['home', 'Room', p.currentRoom ?? '–'],
      ]
    : [
        ['battery', 'Battery', p.battery !== undefined ? `${Math.round(p.battery)}%` : '–'],
        ['zone', 'All time', num(total) !== undefined ? `${Math.round(num(total)!).toLocaleString()} m²` : '–'],
        ['history', 'Runs', num(runs) !== undefined ? String(num(runs)) : '–'],
      ];
  return (
    <div className="vcock-stats">
      {tiles.map(([icon, label, value]) => (
        <div key={label} className="vcock-stat">
          <Icon name={icon} size={18} />
          <strong className="ellipsis">{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

// Consumables as small rings under the hero.
function Parts({ keys }: { keys: Record<string, string> }) {
  const list = useMemo(() => consumables(Object.entries(keys).map(([key, id]) => ({ key, domain: domainOf(id) }))), [keys]);
  const states = useEntities(list.map((x) => keys[x.percent!]));
  if (!list.length) return null;
  return (
    <div className="vcock-parts">
      {list.map((x, i) => {
        const pct = num(states[i]) ?? 0;
        const name = x.key.replace(/_dirty$/, '').replace(/_/g, ' ');
        return (
          <div key={x.key} className={`vcock-part ${pct <= 10 ? 'low' : ''}`} title={`${name}: ${Math.round(pct)}%`}>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15" className="track" />
              <circle cx="18" cy="18" r="15" className="fill" style={{ strokeDasharray: `${(pct / 100) * 94.2} 94.2` }} />
            </svg>
            <span className="vcock-part-pct">{Math.round(pct)}</span>
            <span className="vcock-part-name">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

// Pick rooms without the map: a tile per room, in cleaning order.
function RoomTiles({ p }: { p: VacParts }) {
  if (!p.rooms.length) return null;
  return (
    <section className="panel v-section open flat">
      <div className="v-section-head">
        <span className="v-section-icon">
          <Icon name="tap" size={20} />
        </span>
        <h2 className="label">Pick rooms to clean</h2>
        {p.picked.length > 0 && (
          <button className="chip-btn small" onClick={() => p.setPicked([])}>
            Clear
          </button>
        )}
      </div>
      <div className="v-section-body">
        <div className="vtiles-rooms">
          {sequenced(p.rooms).map((r) => {
            const i = p.picked.indexOf(r.id);
            return (
              <button key={r.id} className={`vroom-tile ${i >= 0 ? 'on' : ''}`} onClick={() => p.togglePick(r.id)} aria-pressed={i >= 0}>
                <span className="vroom-tile-badge">{i >= 0 ? i + 1 : <Icon name="plus" size={16} />}</span>
                <strong className="ellipsis">{r.name}</strong>
              </button>
            );
          })}
        </div>
        <div className="vbar-row end">
          <button className="v-btn" onClick={p.showMap}>
            <Icon name="map" size={18} />
            On the map
          </button>
          <button className="v-btn primary" onClick={p.startRooms} disabled={p.offline}>
            <Icon name="play" size={18} />
            {p.picked.length ? `Clean ${p.picked.length} room${p.picked.length > 1 ? 's' : ''}` : 'Clean everywhere'}
          </button>
        </div>
      </div>
    </section>
  );
}

// Whether the dock is emptying the robot's bin: the auto-empty status sensor,
// else the vacuum's own attribute ("Idle" / "Active").
function useEmptying(p: VacParts): boolean {
  const [s] = useEntities([p.keys.auto_empty_status ?? '']);
  const v = s?.state ?? String(p.vac?.attributes.auto_empty_status ?? '');
  return /^(active|emptying|collecting|dust_collecting)/i.test(v);
}

// The robot in 3D (robot3d.ts): on its dock while docked (see-through with the
// airflow while the dock empties it), turning with its brush and laser spinning
// while it works, the battery as a ring on the floor. Without WebGL it falls
// back to the drawn robot.
function RobotHero({ battery, state, tone, emptying }: { battery?: number; state?: string; tone: Tone; emptying?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<RobotViewer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !canvas.current) return;
    try {
      viewer.current = new RobotViewer(canvas.current, VACUUM.look);
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
    viewer.current?.setState({ state, battery, tone, emptying });
  }, [state, battery, tone, emptying, failed]);

  const pct = Math.round(Math.max(0, Math.min(100, battery ?? 0)));
  if (failed) return <RobotArt battery={battery} state={state} tone={tone} />;
  return (
    <div className="vrobot3d" ref={box}>
      <canvas ref={canvas} aria-label={`Robot, battery ${pct}%`} role="img" />
      <span className="vrobot-pct">{pct}%</span>
    </div>
  );
}

// A top-down robot inside its battery ring (the fallback without WebGL). While
// cleaning the side brush spins and the lidar sweeps; on the dock the ring breathes.
function RobotArt({ battery, state, tone }: { battery?: number; state?: string; tone: Tone }) {
  const pct = Math.max(0, Math.min(100, battery ?? 0));
  const C = 2 * Math.PI * 92;
  const level = pct <= 20 ? 'low' : pct <= 50 ? 'mid' : 'high';
  return (
    <div className={`vrobot state-${state ?? 'unknown'} tone-${tone}`}>
      <svg viewBox="0 0 200 200" role="img" aria-label={`Battery ${Math.round(pct)}%`}>
        <circle cx="100" cy="100" r="92" className="vrobot-track" />
        <circle cx="100" cy="100" r="92" className={`vrobot-battery ${level}`} style={{ strokeDasharray: `${(pct / 100) * C} ${C}` }} transform="rotate(-90 100 100)" />
        <g className="vrobot-body">
          <circle cx="100" cy="100" r="66" className="shell" />
          <circle cx="100" cy="100" r="60" className="top" />
          <path d="M52 76 A60 60 0 0 1 148 76" className="bumper" />
          <g className="brush" transform="translate(58 66)">
            <g className="brush-spin">
              <line x1="0" y1="0" x2="0" y2="-16" />
              <line x1="0" y1="0" x2="14" y2="8" />
              <line x1="0" y1="0" x2="-14" y2="8" />
            </g>
          </g>
          <circle cx="100" cy="82" r="17" className="lidar" />
          <g className="lidar-beam">
            <path d="M100 82 L100 40" />
          </g>
          <circle cx="100" cy="82" r="7" className="lidar-dot" />
          <rect x="88" y="120" width="24" height="7" rx="3.5" className="button" />
          <circle cx="100" cy="140" r="3.5" className="led" />
        </g>
      </svg>
      <span className="vrobot-pct">{Math.round(pct)}%</span>
    </div>
  );
}
