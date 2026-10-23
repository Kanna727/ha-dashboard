import { isUnavailable, fmtWatts, num } from '../../ha/format';
import { Row, sensorText } from '../../vacuum/controls';
import { Icon } from '../Icon';
import { Sparkline } from '../Sparkline';
import { CLEAR, HISTORY_HOURS, clock, duration, nameOf, programLabel, type Dishwasher } from './useDishwasher';

// Pieces of the dishwasher modal (PanelLayout.tsx).

export function Warnings({ dw }: { dw: Dishwasher }) {
  if (!dw.warnings.length) return null;
  return (
    <>
      {dw.warnings.map((w) => (
        <div key={w.entity_id} className="hold-banner">
          <Icon name="alert" size={18} />
          <span><strong>{nameOf(w)}</strong></span>
        </div>
      ))}
    </>
  );
}

export function StatusChips({ dw }: { dw: Dishwasher }) {
  return (
    <>
      {dw.door && !isUnavailable(dw.door) && <span className={`chip ${dw.door.state === 'open' ? 'warn' : ''}`}>{`Door ${dw.door.state}`}</span>}
      {dw.conn && <span className={`chip ${dw.conn.state === 'on' ? 'ok' : 'warn'}`}>{dw.conn.state === 'on' ? 'Connected' : 'Offline'}</span>}
    </>
  );
}

// "40 min left · done 7:31 PM", or when it last finished.
export function TimeLine({ dw }: { dw: Dishwasher }) {
  if (dw.running && dw.remainingMin !== undefined)
    return <span>{`${duration(dw.remainingMin)} left`}{dw.finishAt ? ` · done ${clock(dw.finishAt)}` : ''}</span>;
  if (dw.op === 'finished') return <span>Finished</span>;
  return <span>{dw.current ? programLabel(dw.current) : ''}</span>;
}

export function ProgressBar({ dw }: { dw: Dishwasher }) {
  if (dw.progress === undefined) return null;
  return <div className="progress thick"><i style={{ width: `${dw.progress}%` }} /></div>;
}

export function RemoteHint({ dw }: { dw: Dishwasher }) {
  if (dw.active || !dw.noRemote || dw.unplugged) return null;
  return <div className="muted small">Remote start is off: press Remote Start on the dishwasher.</div>;
}

export function ErrorLine({ dw }: { dw: Dishwasher }) {
  return dw.error ? <div className="dw-error small">{dw.error}</div> : null;
}

// Salt, rinse aid, filter and machine-care reminders: OK or what needs doing.
export function CareList({ dw }: { dw: Dishwasher }) {
  return (
    <>
      {dw.care.map((e) => (
        <Row key={e.entity_id} name={nameOf(e)}>
          <strong className={CLEAR.includes(e.state) ? '' : 'dw-warn-text'}>{CLEAR.includes(e.state) ? 'OK' : sensorText(e)}</strong>
        </Row>
      ))}
    </>
  );
}

export function OtherReadings({ dw }: { dw: Dishwasher }) {
  return (
    <>
      {dw.other.map((r) => (
        <Row key={r.entity_id} name={nameOf(r)}>
          <strong>{sensorText(r)}</strong>
        </Row>
      ))}
    </>
  );
}

export function Energy({ dw, height = 56 }: { dw: Dishwasher; height?: number }) {
  return (
    <>
      {dw.watts && (
        <Row name="Power now">
          <strong>{isUnavailable(dw.watts) ? '–' : fmtWatts(num(dw.watts))}</strong>
        </Row>
      )}
      {dw.history && dw.history.length > 0 && (
        <div className="dw-chart">
          <Sparkline points={dw.history} hours={HISTORY_HOURS} height={height} color="var(--accent-energy)" />
          <div className="muted small">Power, last 24 hours</div>
        </div>
      )}
    </>
  );
}
