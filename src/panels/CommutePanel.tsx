// The commute card (picked by the owner on 2026-10-20 from four trial designs,
// a mix of "traffic strip" and "leave later"): ETA, arrival and traffic level,
// the route as one bar coloured by live speed, and in commute hours the trip
// time if you leave in 15, 30 or 45 minutes. Tapping it opens the map popup.
import { CommuteAside, CommuteDetail, CommuteSubtitle } from '../commute/CommuteDetail';
import { arrival, LeaveLaterBars, leaveAdvice, LevelChip, TrafficStrip, Updated } from '../commute/parts';
import { kmText, mins, TRAFFIC_TEXT, type CommuteConfig } from '../commute/routes';
import { commuteMissingText, useCommute, useCommuteConfig, type Commute } from '../commute/useCommute';
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

export function CommutePanel() {
  const { config, error } = useCommuteConfig();
  if (config) return <Summary config={config} />;
  return (
    <section className="panel commute-panel">
      <PanelHead label="Commute" />
      <p className="muted small">{commuteMissingText(config, error)}</p>
    </section>
  );
}
