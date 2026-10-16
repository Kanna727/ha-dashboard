import { useEffect, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useHass } from '../ha/api';
import { useEntities } from '../ha/store';
import {
  brightnessPct,
  canColor,
  canDim,
  canWarmth,
  cssRgb,
  hsOf,
  hsToRgb,
  inColorMode,
  isMixed,
  kelvinOf,
  kelvinRange,
  kelvinToRgb,
  type HS,
} from '../lib/lightColor';
import { useThrottle } from '../hooks/useThrottle';
import { ColorWheel } from './ColorWheel';
import { Icon } from './Icon';
import { Slider } from './Slider';

export interface SheetLight {
  entity: string;
  name: string;
}

// One-tap colours (hue, saturation).
const SWATCHES: { name: string; hs: HS }[] = [
  { name: 'Soft orange', hs: [28, 70] },
  { name: 'Red', hs: [0, 95] },
  { name: 'Pink', hs: [330, 60] },
  { name: 'Purple', hs: [275, 75] },
  { name: 'Blue', hs: [225, 90] },
  { name: 'Teal', hs: [175, 80] },
  { name: 'Green', hs: [120, 75] },
];
const WHITES = [
  { name: 'Warm', k: 2700 },
  { name: 'Neutral', k: 4000 },
  { name: 'Cool', k: 5500 },
  { name: 'Daylight', k: 6500 },
];

// The lights sheet: brightness, white (warmth) and colour for one light or a
// room's lights (with a Both/All · each light selector). It only offers what
// the selected lights support (from supported_color_modes), sends colour and
// warmth only to the lights that can take them, and says "Mixed" when the
// selected lights are set differently. Drags send throttled live updates and
// a final value on release.
export function LightSheet({ title, lights, onClose }: { title: string; lights: SheetLight[]; onClose: () => void }) {
  const hass = useHass();
  const states = useEntities(lights.map((l) => l.entity));
  const [sel, setSel] = useState<string>('all');
  const picked = lights.map((l, i) => ({ ...l, e: states[i] })).filter((l) => sel === 'all' || l.entity === sel);
  const es = picked.map((l) => l.e);
  const ids = picked.map((l) => l.entity);
  const idsWhere = (f: (e?: HassEntity) => boolean) => picked.filter((l) => f(l.e)).map((l) => l.entity);
  const on = es.filter((e) => e?.state === 'on');
  // The light whose settings the controls show: the first one that's on.
  const lead = on[0] ?? es[0];

  const dim = es.some(canDim);
  const warm = es.some(canWarmth);
  const color = es.some(canColor);
  const [tab, setTab] = useState<'white' | 'colour'>(() => (inColorMode(lead) ? 'colour' : 'white'));
  useEffect(() => {
    if (!color) setTab('white');
  }, [color]);
  const mixed = isMixed(es);
  const [kLo, kHi] = kelvinRange(es);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const call = (service: string, data: Record<string, unknown>, entity_id: string[]) =>
    entity_id.length ? hass.callService('light', service, data, { entity_id }) : Promise.resolve();
  const setBrightness = (v: number) =>
    v <= 0 ? call('turn_off', {}, ids) : Promise.all([call('turn_on', { brightness_pct: v }, idsWhere(canDim)), call('turn_on', {}, idsWhere((e) => !canDim(e)))]);
  const setKelvin = (k: number) => call('turn_on', { color_temp_kelvin: k }, idsWhere(canWarmth));
  const setHs = (hs: HS) => call('turn_on', { hs_color: hs }, idsWhere(canColor));
  const bri = useThrottle(setBrightness);
  const kel = useThrottle(setKelvin);
  const hue = useThrottle(setHs);

  const pct = brightnessPct(lead);
  const k = lead && !inColorMode(lead) ? kelvinOf(lead) : undefined;
  const hs = lead && inColorMode(lead) ? hsOf(lead) : undefined;
  const status = lights.length > 1 && sel === 'all' ? `${on.length} of ${picked.length} on` : on.length ? 'On' : 'Off';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet light-sheet" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label={title}>
        <header>
          <div>
            <h3>{title}</h3>
            <span className="muted">
              {status}
              {on.length > 0 && dim && !mixed ? ` · ${pct}%` : ''}
              {mixed && <span className="mixed-chip">Mixed</span>}
            </span>
          </div>
          <button className={`round ${on.length ? 'active' : ''}`} aria-label={on.length ? 'Turn off' : 'Turn on'} onClick={() => call(on.length ? 'turn_off' : 'turn_on', {}, ids)}>
            <Icon name="power" />
          </button>
        </header>

        {lights.length > 1 && (
          <div className="segmented small" role="tablist" aria-label="Lights">
            {[{ entity: 'all', name: lights.length === 2 ? 'Both' : 'All' }, ...lights].map((l) => (
              <button key={l.entity} role="tab" aria-selected={sel === l.entity} className={sel === l.entity ? 'active' : ''} onClick={() => setSel(l.entity)}>
                {l.name}
              </button>
            ))}
          </div>
        )}

        {dim && (
          <Slider
            className="brightness"
            label="Brightness"
            value={pct}
            valueText={`${pct}%`}
            min={0}
            max={100}
            onInput={(v) => v > 0 && bri.push(v)} // never switch off mid-drag
            onCommit={bri.end}
          >
            <Icon name="lightOn" size={18} />
            <span className="slider-value">{pct}%</span>
          </Slider>
        )}

        {(warm || color) && (
          <>
            {warm && color && (
              <div className="segmented small" role="tablist" aria-label="Mode">
                <button role="tab" aria-selected={tab === 'white'} className={tab === 'white' ? 'active' : ''} onClick={() => setTab('white')}>White</button>
                <button role="tab" aria-selected={tab === 'colour'} className={tab === 'colour' ? 'active' : ''} onClick={() => setTab('colour')}>Colour</button>
              </div>
            )}
            {tab === 'white' && warm && (
              <div className="light-white">
                <Slider
                  className="warmth"
                  label="Warmth"
                  value={k ?? Math.round((kLo + kHi) / 2)}
                  valueText={k ? `${k} K` : 'not set'}
                  min={kLo}
                  max={kHi}
                  step={50}
                  style={{ ['--warm' as string]: cssRgb(kelvinToRgb(kLo)), ['--cool' as string]: cssRgb(kelvinToRgb(kHi)) }}
                  onInput={kel.push}
                  onCommit={kel.end}
                />
                <div className="swatches">
                  {WHITES.filter((w) => w.k >= kLo - 100 && w.k <= kHi + 100).map((w) => (
                    <button key={w.name} className="swatch" style={{ background: cssRgb(kelvinToRgb(w.k)) }} aria-label={w.name} title={w.name} onClick={() => setKelvin(Math.min(kHi, Math.max(kLo, w.k)))}>
                      <span>{w.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tab === 'colour' && color && (
              <div className="light-colour">
                <ColorWheel value={mixed ? undefined : hs} onInput={hue.push} onCommit={hue.end} />
                <div className="swatches">
                  {SWATCHES.map((s) => (
                    <button key={s.name} className="swatch round-swatch" style={{ background: cssRgb(hsToRgb(s.hs)) }} aria-label={s.name} title={s.name} onClick={() => setHs(s.hs)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {!dim && !warm && !color && <p className="muted">These lights only switch on and off.</p>}
        <button className="ghost wide" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
