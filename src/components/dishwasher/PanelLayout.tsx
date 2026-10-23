import { useState, type ReactNode } from 'react';
import { isUnavailable } from '../../ha/format';
import { Choice, useConfirm } from '../../vacuum/controls';
import { DishwasherScene } from '../../dishwasher3d/DishwasherScene';
import { Icon } from '../Icon';
import { CareList, Energy, ErrorLine, OtherReadings, ProgressBar, RemoteHint, StatusChips, TimeLine, Warnings } from './parts';
import { DELAYS, programKey, programLabel, type Dishwasher } from './useDishwasher';

// The dishwasher modal (layout picked by the owner on 2026-10-23 from four on
// trial): the 3D model, then the machine's own control panel recreated in
// CSS, used like the real one: tap a program name to light its segment,
// "Start in hr." adds hours, Intensive Zone / Half Load / the key toggle the
// real options, the left knob is power and the right one Start / Stop (two
// taps). Status, care and power use underneath.

function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <header className="card-head"><h2>{title}</h2></header>}
      {children}
    </section>
  );
}

function StatusHead({ dw }: { dw: Dishwasher }) {
  return (
    <div className="dw-state">
      <span className="stat-val">{dw.label}</span>
      <StatusChips dw={dw} />
    </div>
  );
}

// The six programs printed on the machine, left to right, and the program keys they stand for.
const PANEL_PROGRAMS: { keys: string[]; name: [string, string?]; temp?: string }[] = [
  { keys: ['eco_50'], name: ['Eco'], temp: '50°' },
  { keys: ['auto_2', 'auto_1', 'auto_3'], name: ['Auto'], temp: '45°-65°' },
  { keys: ['intensiv_power'], name: ['Intensive', 'Kadhai'], temp: '70°' },
  { keys: ['quick_65'], name: ['Express'], temp: '65°' },
  { keys: ['pre_rinse'], name: ['Pre-', 'Rinse'] },
  { keys: [], name: ['Favourite'], temp: '☆' },
];

function PanelKey({ name, lit, onClick, disabled, title }: { name: [string, string?]; lit?: boolean; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button className={`dwp-key ${lit ? 'lit' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-pressed={lit}>
      <i className="dwp-cap" />
      <i className="dwp-led" />
      <span>{name[0]}<br />{name[1] ?? ''}</span>
    </button>
  );
}

export function PanelLayout({ dw }: { dw: Dishwasher }) {
  const [delay, setDelay] = useState(0);
  const [armed, tap] = useConfirm();
  const short = (dw.program?.state ?? '').replace(/^dishcare_dishwasher_program_/, '');
  const onPanel = PANEL_PROGRAMS.flatMap((p) => p.keys.map(programKey));
  const extra = dw.programs.filter((p) => !onPanel.includes(p));
  const locked = dw.asleep || dw.active || !dw.on;
  const opt = (suffix: string) => dw.option(suffix);
  const toggleOpt = (suffix: string) => {
    const e = opt(suffix);
    if (e && !isUnavailable(e)) dw.actions.setOption(e.entity_id, e.state !== 'on');
  };
  const optOff = (suffix: string) => locked || !opt(suffix) || isUnavailable(opt(suffix));
  const nextDelay = () => setDelay((d) => DELAYS[(DELAYS.indexOf(d) + 1) % DELAYS.length]);
  const lcd =
    !dw.on ? '' : dw.running && dw.remainingMin !== undefined ? `${Math.floor(dw.remainingMin / 60)}:${String(dw.remainingMin % 60).padStart(2, '0')}` : delay ? `${delay / 3600}h` : '-:--';

  return (
    <div className="dw-b">
      <Warnings dw={dw} />
      <DishwasherScene state={dw.scene} className="dw-b-stage" />
      {dw.ctl && (
        <div className={`dwp ${dw.on ? 'on' : 'off'}`}>
          <div className="dwp-brand"><span><b>Steam</b>Treatment</span><span className="dwp-serie">Serie <i>|</i> <b>6</b></span></div>
          <div className="dwp-row">
            <button
              className={`dwp-knob ${dw.on ? 'on' : ''}`}
              onClick={() => (dw.unplugged ? dw.actions.plugOn() : dw.actions.setPower(!dw.on))}
              disabled={dw.active || (!dw.ctl.power && !dw.unplugged)}
              aria-label={dw.on ? 'Switch off' : 'Switch on'}
              title={dw.unplugged ? 'Switch on at the plug' : 'Power'}
            >
              <Icon name="power" size={18} />
            </button>
            <div className="dwp-module">
              <div className="dwp-programs">
                {PANEL_PROGRAMS.map((p, i) => {
                  const key = p.keys.find((k) => dw.programs.includes(programKey(k)));
                  const lit = dw.on && p.keys.includes(short);
                  return (
                    <PanelKey
                      key={i}
                      name={p.name}
                      lit={lit}
                      disabled={locked || !key}
                      title={key ? programLabel(programKey(key)) : 'Set on the machine'}
                      onClick={() => key && !lit && dw.actions.selectProgram(programKey(key))}
                    />
                  );
                })}
                <div className="dwp-temps">{PANEL_PROGRAMS.map((p, i) => <span key={i}>{p.temp ?? ''}</span>)}</div>
              </div>
              <div className="dwp-lcd" aria-label="Display">
                <Icon name={dw.conn?.state === 'on' ? 'wifi' : 'wifiOff'} size={14} />
                <span className="dwp-digits">{lcd}</span>
              </div>
              <div className="dwp-options">
                <PanelKey name={['Start', 'in hr.']} lit={dw.on && (delay > 0 || dw.op === 'delayedstart')} disabled={locked} onClick={nextDelay} title="Delay the start: tap to add hours" />
                <PanelKey name={['Remote', 'Start']} lit={dw.on && !dw.noRemote} disabled title="Turned on at the machine" />
                <PanelKey name={['Intensive', 'Zone']} lit={dw.on && opt('_intensive_zone')?.state === 'on'} disabled={optOff('_intensive_zone')} onClick={() => toggleOpt('_intensive_zone')} />
                <PanelKey name={['Pre-', 'Treatment']} disabled title="Only on the machine" />
                <PanelKey name={['Half', 'Load']} lit={dw.on && opt('_half_load')?.state === 'on'} disabled={optOff('_half_load')} onClick={() => toggleOpt('_half_load')} />
                {/* Speed Perfect can't be set through Home Connect; its place holds the child lock, which works mid-cycle too. */}
                <PanelKey
                  name={['Child', 'Lock']}
                  lit={opt('_child_lock')?.state === 'on'}
                  disabled={!opt('_child_lock') || isUnavailable(opt('_child_lock'))}
                  onClick={() => toggleOpt('_child_lock')}
                />
                <i className="dwp-lock" aria-hidden="true"><Icon name="lock" size={12} /></i>
              </div>
            </div>
            <button
              className={`dwp-knob start ${armed ? 'armed' : ''}`}
              onClick={() => tap(() => (dw.active ? dw.actions.stop() : dw.actions.start(delay)))}
              disabled={!dw.on || (!dw.active && dw.noRemote)}
              aria-label={dw.active ? 'Stop' : 'Start'}
            >
              <Icon name={dw.active ? 'stop' : 'play'} size={18} />
            </button>
          </div>
          <div className="dwp-foot">
            <span className="muted small">
              {armed ? (dw.active ? 'Tap Stop again to cancel the cycle' : 'Tap Start again to begin') : 'Tap a program, add options, then Start (two taps).'}
            </span>
            {extra.length > 0 && (
              <Choice
                label="Other programs"
                options={['', ...extra]}
                value={extra.includes(dw.program?.state ?? '') ? dw.program?.state : ''}
                disabled={locked}
                format={(o) => (o ? programLabel(o) : 'More programs…')}
                onPick={(o) => o && dw.actions.selectProgram(o)}
              />
            )}
          </div>
          <RemoteHint dw={dw} />
          <ErrorLine dw={dw} />
        </div>
      )}
      <Card className="dw-b-status">
        <StatusHead dw={dw} />
        <div className="muted small"><TimeLine dw={dw} /></div>
        <ProgressBar dw={dw} />
      </Card>
      <Card title="Care"><CareList dw={dw} /><OtherReadings dw={dw} /></Card>
      <Card title="Energy"><Energy dw={dw} /></Card>
    </div>
  );
}
