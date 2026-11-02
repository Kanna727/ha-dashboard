import { useEffect, useState } from 'react';
import { MUSIC_PLAYERS, ROOMS } from '../config/entities';
import { useHass, useHassStatus } from '../ha/api';
import { useEntities } from '../ha/store';
import { isOn } from '../ha/format';
import { useNow } from '../hooks/useNow';
import { Icon } from '../components/Icon';
import { useModal } from '../components/Modal';
import { useIssues } from './useIssues';
import { MusicPlayer, PlayerDots, activePlayers } from './MusicPlayer';
import { cycle, useSwipe } from '../hooks/useSwipe';
import { StatusDialog } from './StatusDialog';
import { ArrangeButton } from '../layout/Canvas';
import { usePage } from '../layout/pages';
import { VacationButton } from '../components/VacationMode';

const greeting = (h: number) => (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

// Shows the first media player that is playing (else the first paused one), and nothing when all are idle.
function NowPlayingPill() {
  const modal = useModal();
  const players = useEntities(MUSIC_PLAYERS.map((p) => p.entity));
  const active = activePlayers(players);
  // Swipe the pill to see the other active players; falls back to the first when the pick goes idle.
  const [picked, setPicked] = useState<number | null>(null);
  const swipe = useSwipe((dir) => active.length > 1 && setPicked(cycle(active, picked ?? active[0], dir)));
  if (active.length === 0) return null;
  const idx = picked !== null && active.includes(picked) ? picked : active[0];
  const paused = players[idx]?.state === 'paused';
  const a = players[idx]?.attributes ?? {};
  const art = a.entity_picture as string | undefined;
  const title = (a.media_title as string | undefined) ?? MUSIC_PLAYERS[idx].name;
  const artist = (a.media_artist as string | undefined) ?? (a.app_name as string | undefined);
  return (
    <button
      className={`pill nowplaying-pill ${paused ? 'paused' : ''}`}
      onClick={() => modal.open({ title: 'Music', icon: 'music', accent: 'var(--accent)', body: <MusicPlayer initial={idx} /> })}
      {...swipe}
      title={`${title}${artist ? ` · ${artist}` : ''} (${MUSIC_PLAYERS[idx].name})`}
    >
      <span className="np-art" style={art ? { backgroundImage: `url(${art})` } : undefined}>
        {!art && <Icon name="music" size={18} />}
      </span>
      <span className="np-text">
        <strong className="ellipsis">{title}</strong>
        <span className="muted ellipsis">{paused ? 'Paused · ' : ''}{artist ? `${artist} · ` : ''}{MUSIC_PLAYERS[idx].name}</span>
      </span>
      {paused ? (
        <span className="np-paused" aria-hidden="true"><Icon name="pause" size={20} /></span>
      ) : (
        <span className="np-eq" aria-hidden="true"><i /><i /><i /></span>
      )}
      <PlayerDots count={active.length} index={active.indexOf(idx)} />
    </button>
  );
}

// Small top-right indicator while the dashboard shows cached states or is
// reconnecting. Fades away once live data is flowing.
function SyncIndicator() {
  const { status } = useHassStatus();
  const [visible, setVisible] = useState(status !== 'live');
  useEffect(() => {
    if (status !== 'live') return setVisible(true);
    const id = window.setTimeout(() => setVisible(false), 600); // let "Synced" flash briefly
    return () => window.clearTimeout(id);
  }, [status]);
  if (!visible) return null;
  const text = status === 'live' ? 'Synced' : status === 'reconnecting' ? 'Reconnecting' : 'Syncing';
  return (
    <div className={`pill sync-pill ${status}`} role="status" aria-live="polite">
      {status === 'live' ? <Icon name="tick" size={16} /> : <span className="sync-spinner" />}
      {text}
    </div>
  );
}

// Lights and fans of each room, for the leaving-home button.
const LEAVE_ROOMS = ROOMS.map((r) => ({
  name: r.name,
  presence: r.presence,
  devices: r.controls.filter((c) => !c.readOnly && /^(light|fan)\./.test(c.entity)).map((c) => c.entity),
}));
const LEAVE_IDS = [...new Set(LEAVE_ROOMS.flatMap((r) => [...r.presence, ...r.devices]))];

// Leaving home: turns off the lights and fans that are on in rooms nobody is in
// (no presence sensor on; Utility has none, so it always counts as empty).
// Two taps, since it switches things off across the house.
function LeaveHomeButton() {
  const hass = useHass();
  const states = useEntities(LEAVE_IDS);
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'done' | 'nothing'>('idle');
  useEffect(() => {
    if (phase === 'idle') return;
    const id = window.setTimeout(() => setPhase('idle'), phase === 'confirm' ? 4000 : 2000);
    return () => window.clearTimeout(id);
  }, [phase]);

  const byId = (id: string) => states[LEAVE_IDS.indexOf(id)];
  const empty = LEAVE_ROOMS.filter((r) => !r.presence.some((p) => byId(p)?.state === 'on'));
  const targets = empty.flatMap((r) => r.devices.filter((d) => isOn(byId(d))));
  const rooms = empty.filter((r) => r.devices.some((d) => targets.includes(d))).map((r) => r.name);

  const label =
    phase === 'confirm' ? `Tap again to turn off ${targets.length} in ${rooms.join(', ')}` : 'Leaving home: turn off lights and fans in empty rooms';
  return (
    <button
      className={`pill icon-pill leave-home ${phase === 'confirm' ? 'confirm' : phase !== 'idle' ? 'note' : ''}`}
      onClick={() => {
        if (phase === 'done') return;
        if (phase !== 'confirm') return setPhase(targets.length ? 'confirm' : 'nothing');
        const lights = targets.filter((t) => t.startsWith('light.'));
        const fans = targets.filter((t) => t.startsWith('fan.'));
        if (lights.length) hass.callService('light', 'turn_off', {}, { entity_id: lights });
        if (fans.length) hass.callService('fan', 'turn_off', {}, { entity_id: fans });
        setPhase('done');
      }}
      aria-label={label}
      title={label}
    >
      <Icon name="leaveHome" size={22} />
      {phase === 'confirm' && <span className="pill-hint">Turn off {targets.length}?</span>}
      {phase === 'nothing' && <span className="pill-hint">All off</span>}
      {phase === 'done' && <span className="pill-hint">Done</span>}
    </button>
  );
}

function StatusPill() {
  const issues = useIssues();
  const modal = useModal();
  const warn = issues.some((i) => i.severity === 'warn');
  const text = issues.length === 0 ? 'All systems normal' : issues.length === 1 ? issues[0].text : `${issues.length} things need attention`;
  return (
    <button
      className={`pill status-pill ${warn ? 'warn' : issues.length ? 'info' : 'ok'}`}
      onClick={() => modal.open({ title: 'Status', icon: 'alert', accent: warn ? 'var(--warn)' : 'var(--ok)', body: <StatusDialog /> })}
    >
      <span className="dot" />
      {text}
    </button>
  );
}

export function TopBar({ compact = false }: { compact?: boolean }) {
  const { userName } = useHassStatus();
  const [page] = usePage();
  const now = useNow(1000);
  const first = userName?.split(' ')[0];

  return (
    <header className={`topbar ${compact ? 'compact' : ''}`}>
      <div className="hello">
        <h1>
          {greeting(now.getHours())}
          {first ? `, ${first}` : ''}
        </h1>
        <div className="muted">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      <div className="topbar-pills">
        <SyncIndicator />
        <NowPlayingPill />
        <StatusPill />
        <LeaveHomeButton />
        <VacationButton />
        {page !== 'clean' && <ArrangeButton />}
      </div>
      <div className="big-clock">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
    </header>
  );
}
