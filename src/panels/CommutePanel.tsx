// The commute card (picked by the owner on 2026-10-20 from four trial designs,
// a mix of "traffic strip" and "leave later"): ETA, arrival and traffic level,
// the route as one bar coloured by live speed, and in commute hours the trip
// time if you leave in 15, 30 or 45 minutes. Tapping it opens the map popup.
import { CommuteAside, CommuteDetail, CommuteSubtitle } from '../commute/CommuteDetail';
import { arrival, LeaveLaterBars, leaveAdvice, LevelChip, TrafficStrip, Updated } from '../commute/parts';
import { kmText, leaveIn, mins, TRAFFIC_TEXT, type CommuteConfig } from '../commute/routes';
import { COMMUTE } from '../config/entities';
import { commuteMissingText, useCommute, useCommuteConfig, type Commute } from '../commute/useCommute';
import { GlanceTile } from '../components/GlanceTile';
import { PanelHead, useModal } from '../components/Modal';

const via = (c: Commute) => (c.route ? `${kmText(c.route.meters)}${c.route.description ? ` · via ${c.route.description}` : ''}` : c.error ? 'Route unavailable' : 'Checking traffic…');

function Summary({ config }: { config: CommuteConfig }) {
  const modal = useModal();
  const c = useCommute(config, { leaveLater: true });
  const r = c.route;
  const open = () =>
    modal.open({
      title: 'Commute',
      icon: 'navigate',
      accent: 'var(--accent-fan)',
      wide: true,
      subtitle: <CommuteSubtitle title={config.title} />,
      aside: <CommuteAside />,
      body: <CommuteDetail config={config} />,
    });
  const heavy = r?.level === 'heavy' && c.inWindow;
  const note = c.leaveLater ? leaveAdvice(c.leaveLater, c.now) : r?.delay ? `+${r.delay} min for traffic` : r ? 'No traffic delay' : '';

  return (
    <section className="panel commute-panel">
      <PanelHead label="Commute" summary={heavy ? TRAFFIC_TEXT.heavy : config.title} summaryClass={heavy ? 'warn' : ''} onMore={open} />
      <div className="cm-card" role="button" tabIndex={0} onClick={open}>
        <div className="cm-top">
          <div className="cm-big">
            {r ? mins(r.seconds) : '–'}
            <small>min</small>
          </div>
          <div className="cm-meta">
            <strong>Arrive {arrival(r, c.now)}</strong>
            <span className="muted small ellipsis">{via(c)}</span>
          </div>
          {r && <LevelChip level={r.level} short />}
        </div>
        {r && <TrafficStrip segs={r.segs} />}
        {c.leaveLater && <LeaveLaterBars options={c.leaveLater} now={c.now} compact />}
        <div className="cm-foot">
          <span className={`small ${c.leaveLater ? 'cm-advice' : 'muted'}`}>{note}</span>
          <Updated c={c} />
        </div>
      </div>
    </section>
  );
}

// `full` (tablet and desktop Commute page): the popup's map, routes and
// leave-later times on the page itself; `compact` stacks them for a narrow column.
function Full({ config, compact }: { config: CommuteConfig; compact: boolean }) {
  return (
    <section className="panel commute-panel full">
      <PanelHead label="Commute" summary={<CommuteAside />} />
      <CommuteDetail config={config} compact={compact} />
    </section>
  );
}

export function CommutePanel({ full = false, compact = false }: { full?: boolean; compact?: boolean }) {
  const { config, error } = useCommuteConfig();
  if (config) return full ? <Full config={config} compact={compact} /> : <Summary config={config} />;
  return (
    <section className="panel commute-panel">
      <PanelHead label="Commute" />
      <p className="muted small">{commuteMissingText(config, error)}</p>
    </section>
  );
}

const TRAFFIC_TONE = { light: undefined, moderate: 'warn', heavy: 'bad' } as const;

function CommuteGlance({ config }: { config: CommuteConfig }) {
  // The same request as the Commute page's old card (no alternatives, with
  // leave-later), so a remount within 2 min reuses its answer (useCommute).
  const c = useCommute(config, { leaveLater: true });
  const r = c.route;
  const advice = c.leaveLater ? leaveAdvice(c.leaveLater, c.now) : undefined;
  // In the commute window with an arrival time: a countdown to leaving,
  // orange from 10 minutes, red once it's too late.
  const left = r && c.inWindow && !c.override ? leaveIn(COMMUTE.arriveBy, r.seconds, c.now) : undefined;
  // Only within two hours of leaving (and an hour after it's too late).
  if (r && left !== undefined && left <= 120 && left >= -60) {
    return (
      <GlanceTile
        icon="navigate"
        label={`Arrive by ${COMMUTE.arriveBy} · ${mins(r.seconds)} min trip`}
        page="commute"
        color="var(--accent-fan)"
        tone={left < 0 ? 'bad' : left <= 10 ? 'warn' : TRAFFIC_TONE[r.level]}
        text={left <= 0}
        value={left < 0 ? `Late ${-left} min` : left === 0 ? 'Leave now' : left}
        unit={left > 0 ? 'min to leave' : undefined}
        sub={advice}
        foot={<TrafficStrip segs={r.segs} ends={false} />}
      />
    );
  }
  return (
    <GlanceTile
      icon="navigate"
      label={config.title}
      page="commute"
      color="var(--accent-fan)"
      tone={r ? TRAFFIC_TONE[r.level] : undefined}
      value={r ? mins(r.seconds) : '–'}
      unit="min"
      sub={r ? advice ?? `Arrive ${arrival(r, c.now)}` : c.error ? 'Route unavailable' : 'Checking traffic…'}
      foot={r ? <TrafficStrip segs={r.segs} ends={false} /> : undefined}
    />
  );
}

// Home page tile (GlancePanel): minutes to the destination now, tinted by the
// traffic, with the route as a strip coloured by live speed.
export function CommuteTile() {
  const { config } = useCommuteConfig();
  return config ? <CommuteGlance config={config} /> : null;
}
