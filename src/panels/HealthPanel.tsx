import { useEffect, useMemo, useState } from 'react';
import { HEALTH } from '../config/entities';
import type { StatPoint } from '../ha/api';
import { readCache, useRegistry, writeCache } from '../ha/useRegistry';
import { GlanceRing, GlanceTile } from '../components/GlanceTile';
import { PanelHead, useModal } from '../components/Modal';
import { Sparkline } from '../components/Sparkline';
import { changeOver, findHealthSources, fmtHours, healthPeople, recoveryTone, sleepStages, type HealthPerson } from '../lib/health';
import { PersonProfile } from './HealthProfile';
import { CACHE_KEY, Chip, colorOf, Delta, fmt, KINDS, TONE_COLOR, toPoints, TREND_DAYS, useDaily, useReader, weightOf } from './healthShared';
// Everyone's health devices (lib/health.ts): found in the registry, matched to
// HEALTH.people, cached so reloads draw at once.
function usePeople(): HealthPerson[] {
  const registry = useRegistry();
  const [people, setPeople] = useState<HealthPerson[]>(() => readCache(CACHE_KEY, []));
  useEffect(() => {
    if (!registry) return;
    const deviceOf = (id: string) => registry.entities.find((e) => e.entityId === id)?.deviceId;
    const next = healthPeople(findHealthSources(registry), HEALTH.people ?? [], deviceOf);
    setPeople((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    writeCache(CACHE_KEY, next);
  }, [registry]);
  return people;
}

// One person on the card: weight and its trend, then what the wearable and
// the riding account say today.
function PersonRow({ p, color, trend, onOpen }: { p: HealthPerson; color: string; trend?: StatPoint[]; onOpen: () => void }) {
  const r = useReader(p);
  const w = weightOf(r);
  const change = trend ? changeOver(trend, 30, Date.now()) : undefined;
  const recovery = r.v('wearable', 'recovery_score');
  const sleep = sleepStages((k) => r.v('wearable', k));
  const strain = r.v('wearable', 'day_strain');
  const riding = r.s('cycling', 'online')?.state.toLowerCase() === 'true' || r.s('cycling', 'online')?.state === 'on';
  const level = r.v('cycling', 'level');
  const streak = r.v('cycling', 'current_streak');
  const fat = r.v('scale', 'body_fat');

  return (
    <button className="hp-person" style={{ ['--pc' as string]: color }} onClick={onOpen}>
      <div className="hp-top">
        <span className="hp-avatar">{p.name.charAt(0).toUpperCase()}</span>
        <div className="hp-main">
          <div className="hp-name">{p.name}</div>
          {w ? (
            <div className="hp-weight">
              <strong>{fmt(w.value, 1)}</strong>
              <small>{w.unit}</small>
              <Delta change={change} unit={w.unit} days={30} />
            </div>
          ) : (
            <div className="muted small">No weight yet</div>
          )}
        </div>
        {trend && trend.length > 1 && (
          <div className="hp-spark">
            <Sparkline points={toPoints(trend)} hours={TREND_DAYS * 24} height={36} color={color} fit />
          </div>
        )}
      </div>
      <div className="hp-chips">
        {riding && (
          <Chip icon="bike" color="var(--accent-energy)">
            Riding · {fmt(r.v('cycling', 'power'))} W
          </Chip>
        )}
        {recovery !== undefined && (
          <Chip icon="heart" color={TONE_COLOR[recoveryTone(recovery)]}>
            Recovery {Math.round(recovery)}%
          </Chip>
        )}
        {sleep && <Chip icon="sleep">{fmtHours(sleep.asleep)}</Chip>}
        {strain !== undefined && <Chip icon="workout">Strain {strain.toFixed(1)}</Chip>}
        {fat !== undefined && <Chip icon="scale">Fat {fat.toFixed(1)}%</Chip>}
        {!riding && level !== undefined && (
          <Chip icon="bike">
            Lvl {Math.round(level)}
            {streak ? ` · ${Math.round(streak)} wk streak` : ''}
          </Chip>
        )}
      </div>
    </button>
  );
}

function HealthDetail({ people, start }: { people: HealthPerson[]; start: number }) {
  const [at, setAt] = useState(start);
  const p = people[at] ?? people[0];
  if (!p) return null;
  return (
    <div className="hp-detail" style={{ ['--pc' as string]: colorOf(p, at) }}>
      {people.length > 1 && (
        <div className="segmented">
          {people.map((x, i) => (
            <button key={x.name + i} className={at === i ? 'active' : ''} onClick={() => setAt(i)}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      <PersonProfile key={at} p={p} color={colorOf(p, at)} />
    </div>
  );
}

// The card ("Rows", the owner's pick on 2026-10-26 over rings and a table): a
// row per person. `full` (tablet and desktop Health page): the popup's trends
// under the rows, for the person whose row was tapped last.
export function HealthPanel({ full = false }: { full?: boolean }) {
  const modal = useModal();
  const people = usePeople();
  const weights = useMemo(
    () => people.map((p) => KINDS.map((k) => p[k]?.roles.weight).find(Boolean)),
    [people],
  );
  const trends = useDaily(weights, TREND_DAYS);
  const [picked, setPicked] = useState(0);
  const open = (i: number) =>
    full ? setPicked(i) : modal.open({ title: 'Health', icon: 'heart', accent: 'var(--danger)', wide: true, body: <HealthDetail people={people} start={i} /> });
  const shown = people[picked] ?? people[0];

  return (
    <section className={`panel health-panel ${full ? 'full' : ''}`}>
      <PanelHead label="Health" summary={full && people.length > 1 ? 'Tap a person for their trends' : undefined} onMore={people.length && !full ? () => open(0) : undefined} />
      {!people.length ? (
        <p className="muted">No scales, wearables or riding accounts found in Home Assistant.</p>
      ) : (
        <ul className="hp-people">
          {people.map((p, i) => (
            <li key={p.name + i} className={full && shown === p ? 'picked' : undefined}>
              <PersonRow p={p} color={colorOf(p, i)} trend={weights[i] ? trends[weights[i]!] : undefined} onOpen={() => open(i)} />
            </li>
          ))}
        </ul>
      )}
      {full && shown && (
        <div className="hp-detail" style={{ ['--pc' as string]: colorOf(shown, people.indexOf(shown)) }}>
          <PersonProfile key={people.indexOf(shown)} p={shown} color={colorOf(shown, people.indexOf(shown))} />
        </div>
      )}
    </section>
  );
}

function PersonGlance({ p, color }: { p: HealthPerson; color: string }) {
  const r = useReader(p);
  const weight = r.v('scale', 'weight');
  const ftp = r.v('cycling', 'ftp');
  const recovery = r.v('wearable', 'recovery_score');
  return (
    <span className="glance-person" style={{ ['--pc' as string]: color }}>
      {recovery !== undefined ? (
        <GlanceRing pct={recovery} color={TONE_COLOR[recoveryTone(recovery)]} size={54}>
          {Math.round(recovery)}
        </GlanceRing>
      ) : (
        <span className="glance-avatar">{p.name.charAt(0).toUpperCase()}</span>
      )}
      <span className="glance-person-text">
        <b>{weight !== undefined ? fmt(weight, 1) : '–'}</b>
        <small>
          {p.name}
          {ftp !== undefined ? ` · FTP ${Math.round(ftp)} W` : ''}
        </small>
      </span>
    </span>
  );
}

// Home page tile (GlancePanel): per person a recovery ring (green, amber or
// red, as WHOOP colours it) from the wearable, the weight from the scale only,
// and the FTP from the riding account.
export function HealthTile() {
  const people = usePeople();
  if (!people.length) return null;
  return (
    <GlanceTile
      icon="heart"
      label="Health · recovery, weight and FTP"
      page="health"
      span={2}
      color="var(--danger)"
      foot={
        <span className="glance-people">
          {people.map((p, i) => (
            <PersonGlance key={p.name + i} p={p} color={colorOf(p, i)} />
          ))}
        </span>
      }
    />
  );
}