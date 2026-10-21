import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useHass } from '../ha/api';
import { useEntity } from '../ha/store';
import { domainOf, isUnavailable } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';
import { Slider } from '../components/Slider';

// Two taps within 4 s for anything that can't be undone (resets, merges, mapping).
export function useConfirm(ms = 4000): [boolean, (run: () => void) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), ms);
    return () => window.clearTimeout(t);
  }, [armed, ms]);
  return [
    armed,
    (run) => {
      if (!armed) return setArmed(true);
      setArmed(false);
      run();
    },
  ];
}

export function ConfirmButton({
  label,
  confirm = 'Tap again',
  icon,
  className = '',
  disabled,
  onConfirm,
}: {
  label: ReactNode;
  confirm?: ReactNode;
  icon?: IconName;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, tap] = useConfirm();
  return (
    <button className={`v-btn ${className} ${armed ? 'armed' : ''}`} disabled={disabled} onClick={() => tap(onConfirm)}>
      {icon && <Icon name={icon} size={18} />}
      {/* Both labels take up space, so the button doesn't move between the two taps. */}
      <span className="v-confirm">
        <span className={armed ? 'off' : ''}>{label}</span>
        <span className={armed ? '' : 'off'} aria-hidden={!armed}>
          {confirm}
        </span>
      </span>
    </button>
  );
}

export function Toggle({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button className={`v-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

// A settings row: name on the left, the control on the right.
export function Row({ name, sub, children, className = '' }: { name: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`v-row ${className}`}>
      <div className="v-row-name">
        <span>{name}</span>
        {sub && <small className="muted">{sub}</small>}
      </div>
      {children !== undefined && <div className="v-row-ctl">{children}</div>}
    </div>
  );
}

const pretty = (s: string) => (/^[a-z0-9_]+$/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

// Options as chips when they fit, else a dropdown.
export function Choice({
  options,
  value,
  disabled,
  label,
  onPick,
  format = pretty,
}: {
  options: string[];
  value: string | undefined;
  disabled?: boolean;
  label: string;
  onPick: (o: string) => void;
  format?: (o: string) => string;
}) {
  const chips = options.length <= 5 && options.join('').length <= 34;
  if (chips)
    return (
      <div className="v-choice" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} role="radio" aria-checked={o === value} className={o === value ? 'active' : ''} disabled={disabled} onClick={() => o !== value && onPick(o)}>
            {format(o)}
          </button>
        ))}
      </div>
    );
  return (
    <select className="v-select" aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onPick(e.target.value)}>
      {value !== undefined && !options.includes(value) && <option value={value}>{format(value)}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {format(o)}
        </option>
      ))}
    </select>
  );
}

const unitOf = (e: HassEntity | undefined) => (e?.attributes.unit_of_measurement as string | undefined) ?? '';

export function sensorText(e: HassEntity | undefined): string {
  if (!e) return '–';
  if (e.state === 'unavailable') return 'Unavailable';
  if (e.state === 'unknown' || e.state === '') return '–';
  if (e.attributes.device_class === 'timestamp') {
    const t = new Date(e.state);
    return Number.isFinite(t.getTime()) ? t.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : e.state;
  }
  if (domainOf(e.entity_id) === 'binary_sensor') return e.state === 'on' ? 'Yes' : 'No';
  const unit = unitOf(e);
  return `${pretty(e.state)}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;
}

// Any entity of the vacuum, with the control its domain calls for.
export function EntityControl({ id, name, confirm }: { id: string; name: string; confirm?: boolean }) {
  const hass = useHass();
  const e = useEntity(id);
  const domain = domainOf(id);
  // Buttons stay "unknown" until first pressed; only "unavailable" means offline for them.
  const off = domain === 'button' || domain === 'input_button' ? !e || e.state === 'unavailable' : isUnavailable(e);
  const target = { entity_id: id };

  switch (domain) {
    case 'switch':
    case 'input_boolean':
      return (
        <Row name={name} sub={off ? 'Unavailable' : undefined}>
          <Toggle on={e?.state === 'on'} disabled={off} label={name} onChange={(on) => hass.callService(domain, on ? 'turn_on' : 'turn_off', {}, target)} />
        </Row>
      );
    case 'select':
    case 'input_select': {
      const options = ((e?.attributes.options as string[] | undefined) ?? []).filter((o) => o !== 'unavailable');
      const unit = unitOf(e);
      return (
        <Row name={name} sub={off ? 'Unavailable' : undefined} className="wrap">
          {!off && options.length > 0 && (
            <Choice
              label={name}
              options={options}
              value={e?.state}
              format={(o) => `${pretty(o)}${unit && /^\d+$/.test(o) ? unit : ''}`}
              onPick={(option) => hass.callService(domain, 'select_option', { option }, target)}
            />
          )}
        </Row>
      );
    }
    case 'number':
    case 'input_number': {
      const a = e?.attributes ?? {};
      const min = (a.min as number) ?? 0;
      const max = (a.max as number) ?? 100;
      const step = (a.step as number) ?? 1;
      const v = parseFloat(e?.state ?? '');
      const unit = unitOf(e);
      const set = (value: number) => hass.callService(domain, 'set_value', { value }, target);
      if (off || !Number.isFinite(v)) return <Row name={name} sub="Unavailable" />;
      if (a.mode === 'box' || (max - min) / step <= 16)
        return (
          <Row name={name}>
            <div className="v-stepper">
              <button className="round small" aria-label={`Less ${name}`} disabled={v <= min} onClick={() => set(Math.max(min, v - step))}>
                <Icon name="minus" size={18} />
              </button>
              <span>
                {v}
                {unit && <small> {unit}</small>}
              </span>
              <button className="round small" aria-label={`More ${name}`} disabled={v >= max} onClick={() => set(Math.min(max, v + step))}>
                <Icon name="plus" size={18} />
              </button>
            </div>
          </Row>
        );
      return (
        <div className="v-row stacked">
          <Slider className="v-slider" label={name} value={v} min={min} max={max} step={step} valueText={`${v}${unit}`} onCommit={set}>
            <span>{name}</span>
            <span className="slider-value">
              {v}
              {unit}
            </span>
          </Slider>
        </div>
      );
    }
    case 'time': {
      const v = (e?.state ?? '').slice(0, 5);
      return (
        <Row name={name} sub={off ? 'Unavailable' : undefined}>
          {!off && (
            <input
              className="v-time"
              type="time"
              aria-label={name}
              value={v}
              onChange={(ev) => ev.target.value && hass.callService('time', 'set_value', { time: `${ev.target.value}:00` }, target)}
            />
          )}
        </Row>
      );
    }
    case 'button':
    case 'input_button':
      return (
        <Row name={name} sub={off ? 'Unavailable' : undefined}>
          {confirm ? (
            <ConfirmButton label="Run" confirm="Sure?" disabled={off} onConfirm={() => hass.callService(domain, 'press', {}, target)} />
          ) : (
            <button className="v-btn" disabled={off} onClick={() => hass.callService(domain, 'press', {}, target)}>
              Run
            </button>
          )}
        </Row>
      );
    default:
      return (
        <Row name={name}>
          <span className="v-value">{sensorText(e)}</span>
        </Row>
      );
  }
}

// Sections shown inside a tab: always open, with a plain header.
export const SectionFlat = createContext(false);

// A collapsible section on the vacuum page.
export function Section({ title, icon, summary, open: initial = false, children }: { title: string; icon: IconName; summary?: ReactNode; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  const flat = useContext(SectionFlat);
  if (flat)
    return (
      <section className="panel v-section open flat">
        <div className="v-section-head">
          <span className="v-section-icon">
            <Icon name={icon} size={20} />
          </span>
          <h2 className="label">{title}</h2>
          {summary !== undefined && <span className="panel-summary">{summary}</span>}
        </div>
        <div className="v-section-body">{children}</div>
      </section>
    );
  return (
    <section className={`panel v-section ${open ? 'open' : ''}`}>
      <button className="v-section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="v-section-icon">
          <Icon name={icon} size={20} />
        </span>
        <h2 className="label">{title}</h2>
        {summary !== undefined && <span className="panel-summary">{summary}</span>}
        <Icon name={open ? 'up' : 'down'} size={20} />
      </button>
      {open && <div className="v-section-body">{children}</div>}
    </section>
  );
}
