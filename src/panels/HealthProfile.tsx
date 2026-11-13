import type { ReactNode } from 'react';
import { BarChart } from '../components/BarChart';
import { Sparkline } from '../components/Sparkline';
import type { StatPoint } from '../ha/api';
import { changeOver, fmtHours, recoveryTone, sleepStages, type HealthPerson, type SourceKind } from '../lib/health';
import { fmt, TONE_COLOR, toPoints, TREND_DAYS, useDaily, useDailyChange, useReader, type Reader } from './healthShared';

// One person's whole page (the owner picked this "Profile" design on
// 2026-11-13 over a bento, a side-by-side table and a tabbed hub): the body
// composition and every scale reading, then everything the wearable says
// (recovery, strain, HRV, sleep, the last workout), then the riding account.
// Each section only shows what that person has; each reading is a tile with
// its 90-day (scale, FTP) or 30-day (wearable) trend.
const NIGHTS = 30;
const shortDay = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

// Scale readings as tiles: [role, title, digits, lowerIsBetter, colour]. Roles
// the scale doesn't have are skipped, so any scale (a device or helpers) works.
const BODY: [string, string, number, boolean, string][] = [
  ['weight', 'Weight', 1, true, 'var(--pc)'],
  ['body_fat', 'Body fat', 1, true, 'var(--warn)'],
  ['body_fat_mass', 'Fat mass', 1, true, 'var(--warn)'],
  ['muscle_mass', 'Muscle', 1, false, 'var(--ok)'],
  ['lean_body_mass', 'Lean mass', 1, false, 'var(--ok)'],
  ['water', 'Water', 1, false, '#38bdf8'],
  ['water_percentage', 'Water', 1, false, '#38bdf8'],
  ['visceral_fat', 'Visceral fat', 0, true, 'var(--warn)'],
  ['bmr', 'BMR', 0, false, '#a78bfa'],
  ['bone_mass', 'Bone', 1, false, '#cbd5e1'],
  ['bmi', 'BMI', 1, true, '#94a3b8'],
];

function Section({ title, source, color, children }: { title: string; source: string; color?: string; children: ReactNode }) {
  return (
    <section className="hp-sec">
      <header>
        <h3 style={color ? { color } : undefined}>{title}</h3>
        <span className="hp-line" />
        <span className="hp-src">{source}</span>
      </header>
      {children}
    </section>
  );
}

// A reading with its trend: the latest value, the change over `days`, a line.
function Tile({ title, value, unit, pts, color, digits = 1, lower = true, days }: { title: string; value?: number; unit: string; pts?: StatPoint[]; color: string; digits?: number; lower?: boolean; days: number }) {
  const ok = (pts ?? []).filter((p) => p.mean !== undefined);
  if (value === undefined && ok.length < 2) return null;
  const change = ok.length > 1 ? changeOver(ok, 30, Date.now()) : undefined;
  const steady = change !== undefined && Math.abs(change) < Math.pow(10, -digits) / 2;
  const better = change === undefined ? undefined : lower ? change < 0 : change > 0;
  return (
    <div className="hp-tile">
      <div className="hp-t">{title}</div>
      <div className="hp-v">
        {fmt(value, digits)}
        <small>{unit}</small>
      </div>
      {change !== undefined && (
        <div className="hp-d" style={{ color: steady ? 'var(--muted)' : better ? 'var(--ok)' : 'var(--warn)' }}>
          {steady ? 'steady' : `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(digits)} ${unit}`.trim()} · 30 d
        </div>
      )}
      {ok.length > 1 && (
        <div className="hp-tspark">
          <Sparkline points={toPoints(ok)} hours={days * 24} height={36} color={color} fit />
        </div>
      )}
    </div>
  );
}

function Bars({ title, bars, caption, height = 70 }: { title: string; bars: { start: number; v: number; color: string }[]; caption: (v: number) => string; height?: number }) {
  if (bars.length < 2) return null;
  const avg = bars.reduce((s, b) => s + b.v, 0) / bars.length;
  return (
    <div className="hp-barsblock">
      <div className="hp-bt">
        <span className="label">{title}</span>
        <span className="muted small">avg {caption(avg)}</span>
      </div>
      <BarChart
        bars={bars.map((b) => ({ key: b.start, parts: [b.v], color: b.color, label: `${shortDay(b.start)}: ${caption(b.v)}` }))}
        colors={['var(--accent)']}
        height={height}
        caption={(b) => (
          <>
            <strong>{caption(b.parts[0])}</strong>
            <span className="muted small">{shortDay(b.key as number)}</span>
          </>
        )}
      />
    </div>
  );
}

function Ring({ pct, color, size, label, sub }: { pct: number; color: string; size: number; label: string; sub: string }) {
  const stroke = Math.round(size / 10);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="hp-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tile)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="hp-ring-in">
        <b style={{ fontSize: size * 0.27 }}>{label}</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}

const Chip2 = ({ children }: { children: ReactNode }) => <span className="chip hp-chip">{children}</span>;

// Fat, muscle and bone as shares of body weight (anything left over is "other").
function Composition({ r }: { r: Reader }) {
  const weight = r.v('scale', 'weight');
  if (!weight) return null;
  const fat = r.v('scale', 'body_fat_mass') ?? (r.v('scale', 'body_fat') !== undefined ? (weight * r.v('scale', 'body_fat')!) / 100 : undefined);
  const muscle = r.v('scale', 'muscle_mass');
  const bone = r.v('scale', 'bone_mass');
  const parts: [string, number | undefined, string][] = [
    ['Fat', fat, 'var(--warn)'],
    ['Muscle', muscle, 'var(--ok)'],
    ['Bone', bone, '#cbd5e1'],
  ];
  const known = parts.filter((x): x is [string, number, string] => x[1] !== undefined);
  if (known.length < 2) return null;
  const other = weight - known.reduce((s, x) => s + x[1], 0);
  if (other > weight * 0.02) known.push(['Other', other, '#475569']);
  return (
    <div className="hp-comp">
      <div className="hp-compbar">
        {known.map(([n, v, c]) => (
          <span key={n} style={{ flex: v, background: c }} />
        ))}
      </div>
      <div className="hp-chips">
        {known.map(([n, v, c]) => (
          <Chip2 key={n}>
            <span style={{ color: c }}>●</span> {n} <b>{Math.round((v / weight) * 100)}%</b>
          </Chip2>
        ))}
      </div>
    </div>
  );
}

function BodySection({ r, color }: { r: Reader; color: string }) {
  const rows = BODY.filter(([role]) => r.id('scale', role) && !(role === 'water_percentage' && r.id('scale', 'water')));
  const ids = rows.map(([role]) => r.id('scale', role));
  const h = useDaily(ids, TREND_DAYS);
  if (!rows.length) return null;
  return (
    <Section title="Body" source="Smart scale" color={color}>
      <Composition r={r} />
      <div className="hp-tiles">
        {rows.map(([role, title, digits, lower, c]) => (
          <Tile key={role} title={title} value={r.v('scale', role)} unit={r.unit('scale', role) || (role === 'weight' || role.endsWith('mass') ? 'kg' : '')} pts={h[r.id('scale', role)!]} color={c === 'var(--pc)' ? color : c} digits={digits} lower={lower} days={TREND_DAYS} />
        ))}
      </div>
    </Section>
  );
}

function WearableSection({ r }: { r: Reader }) {
  const keys = ['recovery_score', 'hrv', 'resting_heart_rate', 'spo2', 'skin_temperature', 'sleep_light_sleep_time', 'sleep_sws_time', 'sleep_rem_sleep_time', 'sleep_respiratory_rate'];
  const h = useDaily(keys.map((k) => r.id('wearable', k)), NIGHTS);
  const strainId = r.id('wearable', 'day_strain');
  const strainDays = useDaily([strainId], NIGHTS, 'max');
  const get = (k: string) => {
    const id = r.id('wearable', k);
    return id ? h[id] ?? [] : [];
  };
  const v = (k: string) => r.v('wearable', k);
  const recent = (pts: StatPoint[]) => pts.filter((x) => x.mean !== undefined).slice(-NIGHTS);
  const recovery = v('recovery_score');
  const strain = v('day_strain');
  const sleep = sleepStages(v);
  const recBars = recent(get('recovery_score')).map((x) => ({ start: x.start, v: x.mean!, color: TONE_COLOR[recoveryTone(x.mean!)] }));
  const stages = ['sleep_light_sleep_time', 'sleep_sws_time', 'sleep_rem_sleep_time'].map((k) => new Map(get(k).map((x) => [x.start, x.mean])));
  const sleepBars = [...stages[0].keys()]
    .map((t) => ({ start: t, v: stages.reduce((s, m) => s + (m.get(t) ?? 0), 0), color: '#818cf8' }))
    .filter((x) => x.v > 0)
    .slice(-NIGHTS);
  const strainBars = recent(strainId ? strainDays[strainId] ?? [] : []).map((x) => ({ start: x.start, v: x.mean!, color: '#38bdf8' }));
  const tile = (key: string, title: string, digits: number, lower: boolean, color: string) => <Tile title={title} value={v(key)} unit={r.unit('wearable', key)} pts={get(key)} color={color} digits={digits} lower={lower} days={NIGHTS} />;
  const stageColors = { awake: '#64748b', light: '#818cf8', deep: '#4f46e5', rem: '#c084fc' };
  const total = sleep ? sleep.asleep + sleep.awake : 0;
  const zones = [0, 1, 2, 3, 4, 5].map((z) => ({ z, h: v(`last_workout_zone_${z}_time`) })).filter((x) => x.h !== undefined && x.h > 0.005);
  const workout = v('last_workout_strain') !== undefined || v('last_workout_average_hr') !== undefined;
  const wkDist = v('last_workout_distance');

  return (
    <Section title="Recovery, sleep and strain" source="WHOOP" color="var(--ok)">
      <div className="hp-recovery">
        <div className="hp-rings">
          {recovery !== undefined && <Ring pct={recovery} color={TONE_COLOR[recoveryTone(recovery)]} size={128} label={`${Math.round(recovery)}%`} sub="Recovery" />}
          {strain !== undefined && <Ring pct={(strain / 21) * 100} color="#38bdf8" size={96} label={strain.toFixed(1)} sub="Strain" />}
        </div>
        <div className="hp-tiles hp-tiles-flush">
          {tile('hrv', 'HRV', 0, false, 'var(--ok)')}
          {tile('resting_heart_rate', 'Resting HR', 0, true, 'var(--danger)')}
          {tile('spo2', 'SpO₂', 1, false, '#38bdf8')}
          {tile('skin_temperature', 'Skin temp', 1, true, '#fb923c')}
        </div>
      </div>

      <div className="hp-two">
        <div className="card hp-card">
          <div className="label">Last night</div>
          {sleep && (
            <>
              <div className="hp-compbar" style={{ marginTop: 10 }}>
                {(['awake', 'light', 'deep', 'rem'] as const).map((s) => (
                  <span key={s} style={{ flex: sleep[s] / total, background: stageColors[s] }} />
                ))}
              </div>
              <div className="hp-chips">
                {(['awake', 'light', 'deep', 'rem'] as const).map((s) => (
                  <Chip2 key={s}>
                    <span style={{ color: stageColors[s] }}>●</span> {s === 'rem' ? 'REM' : s[0].toUpperCase() + s.slice(1)} <b>{fmtHours(sleep[s])}</b>
                  </Chip2>
                ))}
              </div>
              <div className="hp-chips">
                <Chip2>
                  Asleep <b>{fmtHours(sleep.asleep)}</b>
                  {sleep.need !== undefined && (
                    <>
                      {' '}
                      of <b>{fmtHours(sleep.need)}</b> needed
                    </>
                  )}
                </Chip2>
                {v('sleep_performance') !== undefined && (
                  <Chip2>
                    Performance <b>{Math.round(v('sleep_performance')!)}%</b>
                  </Chip2>
                )}
                {v('sleep_efficiency') !== undefined && (
                  <Chip2>
                    Efficiency <b>{Math.round(v('sleep_efficiency')!)}%</b>
                  </Chip2>
                )}
                {v('sleep_consistency') !== undefined && (
                  <Chip2>
                    Consistency <b>{Math.round(v('sleep_consistency')!)}%</b>
                  </Chip2>
                )}
                {v('sleep_respiratory_rate') !== undefined && (
                  <Chip2>
                    Breathing <b>{v('sleep_respiratory_rate')!.toFixed(1)}</b> rpm
                  </Chip2>
                )}
                {v('sleep_disturbances') !== undefined && (
                  <Chip2>
                    Disturbances <b>{Math.round(v('sleep_disturbances')!)}</b>
                  </Chip2>
                )}
                {v('sleep_cycles') !== undefined && (
                  <Chip2>
                    Cycles <b>{Math.round(v('sleep_cycles')!)}</b>
                  </Chip2>
                )}
              </div>
            </>
          )}
          <Bars title="Hours asleep" bars={sleepBars} caption={(x) => fmtHours(x)} />
          <Bars title="Recovery" bars={recBars} caption={(x) => `${Math.round(x)}%`} />
        </div>
        <div className="card hp-card">
          <div className="label">Day strain</div>
          <Bars title="Highest each day" bars={strainBars} caption={(x) => x.toFixed(1)} />
          <div className="hp-chips">
            {v('day_calories') !== undefined && (
              <Chip2>
                Calories <b>{Math.round(v('day_calories')!)}</b>
              </Chip2>
            )}
            {v('day_average_heart_rate') !== undefined && (
              <Chip2>
                Avg HR <b>{Math.round(v('day_average_heart_rate')!)}</b>
              </Chip2>
            )}
            {v('day_max_heart_rate') !== undefined && (
              <Chip2>
                Max HR <b>{Math.round(v('day_max_heart_rate')!)}</b>
              </Chip2>
            )}
            {v('max_heart_rate') !== undefined && (
              <Chip2>
                Ceiling <b>{Math.round(v('max_heart_rate')!)}</b>
              </Chip2>
            )}
          </div>
          {workout && (
            <>
              <div className="label" style={{ marginTop: 16 }}>
                Last workout
              </div>
              <div className="hp-chips">
                {v('last_workout_strain') !== undefined && (
                  <Chip2>
                    Strain <b>{v('last_workout_strain')!.toFixed(1)}</b>
                  </Chip2>
                )}
                {v('last_workout_average_hr') !== undefined && (
                  <Chip2>
                    <b>{Math.round(v('last_workout_average_hr')!)}</b>
                    {v('last_workout_max_hr') !== undefined ? `–${Math.round(v('last_workout_max_hr')!)}` : ''} bpm
                  </Chip2>
                )}
                {v('last_workout_calories') !== undefined && (
                  <Chip2>
                    <b>{Math.round(v('last_workout_calories')!)}</b> kcal
                  </Chip2>
                )}
                {wkDist !== undefined && (
                  <Chip2>
                    <b>{wkDist.toFixed(1)}</b> {r.unit('wearable', 'last_workout_distance') || 'km'}
                  </Chip2>
                )}
                {zones.map((x) => (
                  <Chip2 key={x.z}>
                    Zone {x.z} <b>{fmtHours(x.h)}</b>
                  </Chip2>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

function RidingSection({ r }: { r: Reader }) {
  const ftpId = r.id('cycling', 'ftp');
  const h = useDaily([ftpId], TREND_DAYS);
  const distId = r.id('cycling', 'total_distance');
  const perKm = /^m$/i.test(r.unit('cycling', 'total_distance')) ? 1000 : 1;
  const rides = useDailyChange(distId, NIGHTS).map((x) => ({ start: x.start, v: Math.max(0, x.change) / perKm, color: '#fbbf24' }));
  const v = (k: string) => r.v('cycling', k);
  const level = v('level');
  const progress = v('cycle_progress');
  const streak = v('current_streak');
  const best = v('max_streak');
  const score = v('racing_score');
  const cat = r.s('cycling', 'racing_category')?.state;
  const total = v('total_distance');
  const climbed = v('total_distance_climbed');
  const time = v('total_time');
  const timeUnit = r.unit('cycling', 'total_time');
  const hours = time === undefined ? undefined : /^d/i.test(timeUnit) ? time * 24 : /^m/i.test(timeUnit) ? time / 60 : time;
  const live = r.s('cycling', 'online')?.state.toLowerCase() === 'true' || r.s('cycling', 'online')?.state === 'on';
  return (
    <Section title={live ? 'Riding now' : 'Riding'} source="Zwift" color="#fbbf24">
      <div className="hp-tiles">
        {level !== undefined && (
          <div className="hp-tile">
            <div className="hp-t">Level</div>
            <div className="hp-v">
              {Math.round(level)}
              {progress !== undefined && <small>{Math.round(progress)}% to next</small>}
            </div>
            {progress !== undefined && (
              <div className="hp-meter">
                <span style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: '#fbbf24' }} />
              </div>
            )}
          </div>
        )}
        <Tile title="FTP" value={v('ftp')} unit="W" pts={ftpId ? h[ftpId] : undefined} color="#fbbf24" digits={0} lower={false} days={TREND_DAYS} />
        {streak !== undefined && (
          <div className="hp-tile">
            <div className="hp-t">Streak</div>
            <div className="hp-v">
              {Math.round(streak)}
              <small>wk{best !== undefined ? ` · best ${Math.round(best)}` : ''}</small>
            </div>
          </div>
        )}
        {score !== undefined && (
          <div className="hp-tile">
            <div className="hp-t">Racing</div>
            <div className="hp-v">
              {Math.round(score)}
              {cat && cat !== 'unknown' && <small>cat {cat}</small>}
            </div>
          </div>
        )}
        {total !== undefined && (
          <div className="hp-tile">
            <div className="hp-t">Ridden</div>
            <div className="hp-v">
              {Math.round(total / perKm)}
              <small>km</small>
            </div>
            <div className="hp-d muted">
              {climbed !== undefined ? `${(climbed / (perKm === 1000 ? 1000 : 1)).toFixed(1)} km climbed` : ''}
              {hours !== undefined ? `${climbed !== undefined ? ' · ' : ''}${Math.round(hours)} h in the saddle` : ''}
            </div>
          </div>
        )}
        {rides.length > 1 && (
          <div className="hp-tile hp-tile-bars">
            <Bars title="Km per day" bars={rides} caption={(x) => `${x.toFixed(1)} km`} height={56} />
          </div>
        )}
      </div>
    </Section>
  );
}

const has = (p: HealthPerson, k: SourceKind) => !!p[k];

export function PersonProfile({ p, color }: { p: HealthPerson; color: string }) {
  const r = useReader(p);
  return (
    <div className="hp-profile">
      {has(p, 'scale') && <BodySection r={r} color={color} />}
      {has(p, 'wearable') && <WearableSection r={r} />}
      {has(p, 'cycling') && <RidingSection r={r} />}
    </div>
  );
}
