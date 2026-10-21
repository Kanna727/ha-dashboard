import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { APPLIANCES, FAN_MANUAL_OFF, ROOMS, type RoomDef } from '../config/entities';
import { useHass } from '../ha/api';
import { store, useAllEntities, useEntities, useEntity } from '../ha/store';
import { useGates } from '../ha/automations';
import { ambienceSensor, describeGate, gatesFor, heldBack, type Gate, type Read } from '../lib/thresholds';
import { fmtNum, fmtWatts, isOn, isUnavailable, num } from '../ha/format';
import { AppliancesCard } from '../components/AppliancesCard';
import { usePurifier } from '../components/usePurifier';
import { useDishShine } from '../components/useDishShine';
import { DishRack } from '../components/DishRack';
import { FanIcon } from '../components/FanIcon';
import { LightIcon } from '../components/LightIcon';
import { ClimateCard } from '../components/ClimateCard';
import { MediaCard } from '../components/MediaCard';
import { EntityTile } from '../components/EntityTile';
import { Icon, type IconName } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { useSlide } from '../hooks/useSlide';
import { useThrottle } from '../hooks/useThrottle';
import { useNow } from '../hooks/useNow';
import { useOpenSheet } from '../components/Sheet';
import { VacuumChip } from '../vacuum/VacuumChip';
import { brightnessPct, canDim, cssRgb, inColorMode, lightRgb, luminance } from '../lib/lightColor';
import { percentToSend, speedCount, speedOf } from '../lib/fanSpeed';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

const lightsOf = (r: RoomDef) => r.controls.filter((c) => c.entity.startsWith('light.')).map((c) => c.entity);
const roomLit = (r: RoomDef, all: HassEntities) => lightsOf(r).some((id) => all[id]?.state === 'on');
// Where each light's glow shines from along the card's top edge: one light from
// the top-right corner, several spread towards the left.
const glowX = (i: number, n: number) => (n < 2 ? 88 : 88 - (i * 62) / (n - 1));
// A chip's slide spans the card's width, whatever the chip's own size.
const cardWidth = (el: HTMLElement) => el.closest('.room-row')?.getBoundingClientRect().width ?? 0;

// Fans in the room whose "manual off" flag is on, i.e. automations won't turn them on.
function useHeldFans(room: RoomDef) {
  const fans = room.controls.filter((c) => FAN_MANUAL_OFF[c.entity]);
  const flags = useEntities(fans.map((c) => FAN_MANUAL_OFF[c.entity]));
  return fans.filter((_, i) => flags[i]?.state === 'on');
}

// What the room's automations make of a reading: the rule ("above 27") and
// whether the reading is what's keeping the devices off right now.
interface ReadingRule {
  rule: string;
  held: boolean;
}

// Temperature, humidity and light level, plus the thresholds the automations
// gate on (read from the automations themselves, lib/thresholds.ts): the
// temperature for the room's fans, the light level for its lights. The light
// sensor is the one the room's light automations use.
function useRoomReadings(room: RoomDef, gates: Gate[]) {
  const ambienceId = useMemo(() => ambienceSensor(gates, lightsOf(room)), [gates, room]);
  const temp = useEntity(room.temperature);
  const hum = useEntity(room.humidity);
  const ambience = useEntity(ambienceId);
  // The rules depend on flags, limits and device states, so they are worked
  // out against the whole store; React gets a string, so a room only
  // re-renders when its rules change.
  const sig = useSyncExternalStore(store.subscribe, () => {
    const all = store.getAll();
    const read: Read = (id) => all[id]?.state;
    const rule = (sensor: string | undefined, devices: string[]): ReadingRule | null => {
      const any = gatesFor(gates, sensor, devices, read, false);
      if (!any.length) return null;
      return {
        rule: [...new Set(any.map((g) => describeGate(g, read)))].join(' or '),
        held: heldBack(gatesFor(gates, sensor, devices, read), read),
      };
    };
    const fans = room.controls.filter((c) => c.entity.startsWith('fan.')).map((c) => c.entity);
    return JSON.stringify([rule(room.temperature, fans), rule(ambienceId, lightsOf(room))]);
  });
  const [tempRule, ambienceRule] = useMemo(() => JSON.parse(sig) as (ReadingRule | null)[], [sig]);
  const unit = ambience?.attributes.unit_of_measurement as string | undefined;
  const lux = unit ? ` ${unit}` : '';
  return {
    temp,
    hum,
    ambience,
    lux,
    tempRule,
    ambienceRule,
    tempNote: tempRule && (tempRule.held ? `Fan stays off: automations turn it on ${tempRule.rule}°` : `Automations turn the fan on ${tempRule.rule}°`),
    ambienceNote:
      ambienceRule && (ambienceRule.held ? `Lights stay off: automations turn them on ${ambienceRule.rule}${lux}` : `Automations turn the lights on ${ambienceRule.rule}${lux}`),
  };
}

// "26.4° · 72% · ☀ 12 lx" on the room card. A reading turns red while it's
// what keeps the room's fan or lights off (too cool, too bright).
function Readings({ r }: { r: ReturnType<typeof useRoomReadings> }) {
  const items: ReactNode[] = [];
  if (r.temp) items.push(<span key="t" className={r.tempRule?.held ? 'held' : undefined} title={r.tempNote ?? undefined}>{fmtNum(r.temp, 1)}°</span>);
  if (r.hum) items.push(<span key="h">{fmtNum(r.hum)}%</span>);
  if (r.ambience)
    items.push(
      <span key="a" className={r.ambienceRule?.held ? 'held' : undefined} title={r.ambienceNote ?? 'Light level'}>
        <Icon name="ambience" size={12} />
        {fmtNum(r.ambience)}
        {r.lux}
      </span>,
    );
  if (!items.length) return null;
  return <span className="room-row-readings">{items.flatMap((x, i) => (i ? [' · ', x] : [x]))}</span>;
}

function RoomDetail({ room, gates }: { room: RoomDef; gates: Gate[] }) {
  const r = useRoomReadings(room, gates);
  const { temp, hum, ambience } = r;
  const held = useHeldFans(room);
  return (
    <div>
      {held.map((f) => (
        <div key={f.entity} className="hold-banner">
          <Icon name="lock" size={18} />
          <span>
            <strong>{f.name === 'Fan' ? `${room.name} fan` : f.name} is on manual override.</strong> Automations won't turn it on until the flag is cleared.
          </span>
        </div>
      ))}
      {(temp || hum || ambience) && (
        <div className={`stat-tiles two ${[temp, hum, ambience].filter(Boolean).length > 2 ? 'three' : ''}`}>
          {temp && (
            <div className={`stat-tile ${r.tempRule?.held ? 'held' : ''}`}>
              <div className="label">Temperature</div>
              <div className="stat-val">{fmtNum(temp, 1)}<small>°C</small></div>
              {r.tempRule && <div className="stat-rule">Fan {r.tempRule.held ? 'needs' : 'on'} {r.tempRule.rule}°</div>}
            </div>
          )}
          {hum && <div className="stat-tile"><div className="label">Humidity</div><div className="stat-val">{fmtNum(hum)}<small>%</small></div></div>}
          {ambience && (
            <div className={`stat-tile ${r.ambienceRule?.held ? 'held' : ''}`}>
              <div className="label">Light level</div>
              <div className="stat-val">{fmtNum(ambience)}<small>{r.lux.trim()}</small></div>
              {r.ambienceRule && <div className="stat-rule">Lights {r.ambienceRule.held ? 'need' : 'on'} {r.ambienceRule.rule}{r.lux}</div>}
            </div>
          )}
        </div>
      )}
      <div className="tiles roomy">{room.controls.map((c) => <EntityTile key={c.entity} {...c} />)}</div>
      {room.detailCards?.includes('climate') && <div className="detail-card"><ClimateCard /></div>}
      {room.detailCards?.includes('media') && <div className="detail-card"><MediaCard /></div>}
      {room.appliances?.some((a) => a !== 'vacuum') && <div className="detail-card"><AppliancesCard kinds={room.appliances} /></div>}
    </div>
  );
}

// "7:40" from a timestamp sensor (no AM/PM: it's next to a progress %).
function clockTime(iso: string | undefined) {
  const d = iso ? new Date(iso) : undefined;
  return !d || Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
}

// How long something has been on ("now", "12m", "1h 5m"), ticking twice a minute.
// A leaf of its own so only the label re-renders.
function Since({ at }: { at: string | undefined }) {
  const now = useNow(30000);
  const m = at ? Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 60000)) : NaN;
  if (Number.isNaN(m)) return null;
  return <>{m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}</>;
}

// Appliance status, shared by the room card chips and note line. The purifier
// has no chip and never "runs"; it only puts a fault in the note line.
function useApplianceStatus() {
  const washer = useEntity(APPLIANCES.washer.running);
  const washerPower = useEntity(APPLIANCES.washer.power);
  const dwState = useEntity(APPLIANCES.dishwasher.state);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress);
  const dwFinish = useEntity(APPLIANCES.dishwasher.finish);
  const pct = num(dwProgress);
  const dwRunning = pct !== undefined && pct > 0 && pct < 100;
  const purifier = usePurifier();
  return {
    // short: the state alone, for the card's chips; done: the dishwasher's finish time.
    washer: {
      running: washer?.state === 'on',
      text: washer?.state === 'on' ? `Washer ${fmtWatts(num(washerPower))}` : 'Washer idle',
      short: washer?.state === 'on' ? fmtWatts(num(washerPower)) : 'Idle',
    },
    dishwasher: {
      running: dwRunning,
      pct: dwRunning ? pct! : undefined,
      text: dwRunning ? `Dishwasher ${Math.round(pct!)}%` : isUnavailable(dwState) ? 'Dishwasher asleep' : 'Dishwasher idle',
      short: dwRunning ? `${Math.round(pct!)}%` : isUnavailable(dwState) ? 'Asleep' : 'Idle',
      done: dwRunning ? clockTime(dwFinish?.state) : '',
    },
    purifier: { running: false, fault: purifier.activeFaults.length > 0, text: purifier.text, short: '' },
  };
}

function RoomRow({ room, gates }: { room: RoomDef; gates: Gate[] }) {
  const hass = useHass();
  const modal = useModal();
  const readings = useRoomReadings(room, gates);
  const quick = useEntity(room.quick?.entity);
  const lightIds = lightsOf(room);
  const lights = useEntities(lightIds);
  const controls = useEntities(room.controls.map((c) => c.entity));
  const presence = useEntities(room.presence);
  const doors = useEntities(room.doors);
  const held = useHeldFans(room);
  const quickHeld = !!room.quick && held.some((f) => f.entity === room.quick!.entity);

  const lit = lights.filter(isOn).length;
  const others = room.controls.filter((c, i) => !c.entity.startsWith('light.') && !c.readOnly && isOn(controls[i]));
  const occupied = presence.some((p) => p?.state === 'on');
  const doorOpen = doors.some((d) => d?.state === 'on');
  const appStatus = useApplianceStatus();
  const runningApps = (room.appliances ?? []).filter((a) => a !== 'vacuum' && appStatus[a].running);
  // Dishwasher cycle progress, drawn as a read-only fill behind the card.
  const progress = room.appliances?.includes('dishwasher') ? appStatus.dishwasher.pct : undefined;
  // For a few minutes after a cycle, the dishes on the card shine.
  const dishShine = useDishShine(!!room.appliances?.includes('dishwasher'), appStatus.dishwasher.running);

  // The quick fan's speed: sliding across its chip sets it (snapped to the
  // fan's speed steps; all the way left = off).
  const isFan = room.quick?.kind === 'fan';
  const fanStep = (quick?.attributes.percentage_step as number | undefined) || 100 / 6;
  const fanPct = isOn(quick) ? ((quick?.attributes.percentage as number | undefined) ?? 100) : 0;
  const fanSlide = useSlide({
    value: fanPct,
    step: fanStep,
    enabled: isFan && !!quick && quick.state !== 'unavailable',
    range: cardWidth,
    onCommit: (v) => {
      const target = { entity_id: room.quick!.entity };
      if (v <= 0) hass.callService('fan', 'turn_off', {}, target);
      else hass.callService('fan', 'set_percentage', { percentage: percentToSend(v) }, target);
    },
  });
  const fanSpeeds = speedCount(fanStep);
  const fanSpeed = speedOf(fanSlide.value, fanStep);

  // A line for what the chips can't show: clean dishes, a purifier fault, or
  // another device that's on (not the quick one, whose chip already says so).
  // The washer's plug is always on, so a room with the washer never says "Washer on".
  const notes: string[] = [];
  if (dishShine) notes.push('Dishes clean');
  if (room.appliances?.includes('purifier') && appStatus.purifier.fault) notes.push(appStatus.purifier.text);
  const otherOn = others.find((c) => c.entity !== room.quick?.entity);
  if (!notes.length && !lit && !runningApps.length && otherOn && !room.appliances?.includes('washer')) notes.push(`${otherOn.name} on`);

  // The lights button: a tap toggles every light in the room, a slide across it
  // sets them all to one brightness (live, throttled), and a long press opens
  // the lights sheet (brightness, warmth, colour, each light). It shows the
  // brightest light that's on, in that light's colour.
  const openSheet = useOpenSheet();
  const brightest = lights.filter(isOn).reduce<HassEntity | undefined>((b, l) => (!b || brightnessPct(l) > brightnessPct(b) ? l : b), undefined);
  const litRgb = lightRgb(brightest);
  const setRoomBrightness = (v: number) => {
    if (v <= 0) return hass.callService('light', 'turn_off', {}, { entity_id: lightIds });
    const dimmable = lightIds.filter((_, i) => canDim(lights[i]));
    const plain = lightIds.filter((_, i) => !canDim(lights[i]));
    if (dimmable.length) hass.callService('light', 'turn_on', { brightness_pct: v }, { entity_id: dimmable });
    if (plain.length) hass.callService('light', 'turn_on', {}, { entity_id: plain });
  };
  const bulbLive = useThrottle(setRoomBrightness);
  const bulbSlide = useSlide({
    value: brightest ? brightnessPct(brightest) : 0,
    step: 1,
    enabled: lights.some(canDim),
    range: cardWidth, // the same feel as the fan chip
    keyStep: 10,
    onInput: (v) => v > 0 && bulbLive.push(v), // never switch off mid-drag
    onCommit: bulbLive.end,
    onLongPress: () =>
      openSheet({
        entity: lightIds[0],
        name: `${room.name} lights`,
        lights: room.controls.filter((c) => c.entity.startsWith('light.')).map((c) => ({ entity: c.entity, name: c.name })),
      }),
  });
  const bulbPct = bulbSlide.value;
  const bulbOn = bulbSlide.sliding ? bulbPct > 0 : lit > 0;
  // A colour light tints the button; white light keeps the usual yellow.
  const bulbStyle =
    litRgb && inColorMode(brightest)
      ? { ['--tint' as string]: cssRgb(litRgb), color: bulbOn && luminance(litRgb) < 0.35 ? '#fff' : undefined }
      : undefined;

  const toggleLights = (e: React.MouseEvent) => {
    e.stopPropagation();
    hass.callService('light', lit ? 'turn_off' : 'turn_on', {}, { entity_id: lightIds });
  };

  const quickOn = isOn(quick);
  const quickOffline = !quick || quick.state === 'unavailable';
  const toggleQuick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!room.quick) return;
    hass.callService(room.quick.entity.split('.')[0], 'toggle', {}, { entity_id: room.quick.entity });
  };
  const quickName = room.quick?.kind === 'geyser' ? 'geyser' : (quick?.attributes.friendly_name as string | undefined) ?? 'fan';
  const openDetail = () =>
    modal.open({ title: room.name, icon: room.icon as IconName, accent: lit ? 'var(--accent-light)' : undefined, body: <RoomDetail room={room} gates={gates} /> });

  // While sliding, the chips show the value being set, so the note steps aside.
  const note = fanSlide.sliding || bulbSlide.sliding ? '' : notes.join(' · ');
  const heldOther = held.filter((f) => f.entity !== room.quick?.entity);
  const dimmable = lights.some(canDim);

  const layers = (
    <>
      {/* Ambient state layers behind the content (transform/opacity animations only). */}
      {lightIds.length > 0 && (
        <span className="room-glows" aria-hidden="true">
          {lights.map((l, i) => {
            // While the lights button is being dragged, every light follows the level being set.
            const pct = bulbSlide.sliding ? bulbPct : brightnessPct(l);
            const rgb = lightRgb(l);
            return (
              <span
                key={lightIds[i]}
                className={`room-glow ${pct > 0 ? 'on' : ''}`}
                style={{
                  ['--x' as string]: `${glowX(i, lightIds.length)}%`,
                  ['--b' as string]: (pct / 100).toFixed(2),
                  ['--glow-color' as string]: rgb ? cssRgb(rgb) : 'var(--accent-light)',
                }}
              />
            );
          })}
        </span>
      )}
      {room.quick?.kind === 'geyser' && quickOn && (
        <span className="room-heat" aria-hidden="true">
          {/* Bubbles rising from the bottom, growing and wobbling, then popping. */}
          <i /><i /><i /><i /><i /><i /><i /><i />
        </span>
      )}
      {progress !== undefined && (
        <span className="room-row-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
      {(progress !== undefined || dishShine) && <DishRack pct={progress ?? 100} shining={dishShine} />}
    </>
  );

  // The control chips: off is a plain icon; on grows and says what it's doing
  // (the light and fan fill to their level, the geyser says how long it has
  // been on, the dishwasher its progress and finish time). A held quick fan
  // says "Held".
  const label = (text: ReactNode) => <span className="row-btn-label">{text}</span>;
  const chips = (
    <span className="row-buttons">
      {room.appliances?.filter((a): a is 'washer' | 'dishwasher' => a === 'washer' || a === 'dishwasher').map((a) => (
        <button
          key={a}
          className={`row-btn ${a} ${appStatus[a].running ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            openDetail();
          }}
          aria-label={appStatus[a].text}
          title={appStatus[a].text}
        >
          <Icon name={a} size={22} className={a === 'washer' && appStatus[a].running ? 'wobble' : undefined} />
          {appStatus[a].running &&
            label(
              a === 'dishwasher' && appStatus.dishwasher.done ? (
                <>
                  {appStatus.dishwasher.short} · <span className="lbl-word">done </span>
                  {appStatus.dishwasher.done}
                </>
              ) : (
                appStatus[a].short
              ),
            )}
        </button>
      ))}
      {room.appliances?.includes('vacuum') && <VacuumChip />}
      {room.quick && (
        <button
          className={`row-btn ${room.quick.kind} ${quickOn ? 'on' : ''} ${isFan ? 'lvl-fill' : ''} ${quickHeld && !quickOn ? 'held' : ''} ${fanSlide.sliding ? 'sliding' : ''}`}
          style={isFan ? { ['--level' as string]: `${fanSlide.value}%` } : undefined}
          disabled={quickOffline}
          onClick={toggleQuick}
          {...(isFan ? fanSlide.handlers : {})}
          aria-label={`${quickOn ? 'Turn off' : 'Turn on'} ${room.name} ${quickName}${quickHeld ? ' (manual override on)' : ''}`}
          aria-keyshortcuts={isFan ? 'ArrowLeft ArrowRight' : undefined}
          title={quickHeld ? 'Manual override: automations will not turn this fan on' : isFan ? 'Tap to switch, slide to set the speed' : undefined}
        >
          {isFan ? <FanIcon on={quickOn} pct={fanSlide.value} size={22} /> : <Icon name="geyser" size={22} />}
          {isFan
            ? (fanSpeed > 0 || quickHeld) && label(fanSpeed ? `${fanSpeed}/${fanSpeeds}` : 'Held')
            : quickOn && label(<>On · <Since at={quick?.last_changed} /></>)}
          {quickHeld && <span className="hold-badge"><Icon name="lock" size={11} /></span>}
        </button>
      )}
      {lightIds.length > 0 && (
        <button
          className={`row-btn bulb ${bulbOn ? 'on' : ''} ${bulbSlide.sliding ? 'sliding' : ''} ${dimmable ? 'lvl-fill' : ''}`}
          style={{ ...bulbStyle, ['--level' as string]: `${bulbPct}%` }}
          onClick={toggleLights}
          {...bulbSlide.handlers}
          aria-label={`${lit ? 'Turn off' : 'Turn on'} ${room.name} lights`}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          title="Tap to switch, slide to dim, hold for colour"
        >
          <LightIcon on={bulbOn} brightness={bulbPct / 100} color={litRgb} size={22} />
          {bulbOn && label(dimmable ? `${bulbPct}%` : 'On')}
        </button>
      )}
    </span>
  );

  return (
    <div
      className={`room-row ${lit ? 'lit' : ''}`}
      style={litRgb ? { ['--room-light' as string]: cssRgb(litRgb) } : undefined}
      role="button"
      tabIndex={0}
      onClick={openDetail}
    >
      {layers}
      <div className="room-row-head">
        <Icon name={room.icon as IconName} size={16} />
        <span className="room-row-name">
          {room.name}
          {occupied && <span className="presence-dot" title="Someone's here" />}
          {doorOpen && <Icon name="doorOpen" size={14} className="door-warn" />}
        </span>
      </div>
      <Readings r={readings} />
      {note && <span className="room-row-sub">{note}</span>}
      {chips}
      {/* The quick fan's chip already says "Held"; other held fans get a line. */}
      {heldOther.length > 0 && (
        <span className="hold-note">
          {heldOther.length > 1 ? 'Fans' : heldOther[0].name.toLowerCase().includes('fan') ? heldOther[0].name : `${heldOther[0].name} fan`} on manual override
        </span>
      )}
    </div>
  );
}

export function RoomsPanel() {
  const all = useAllEntities();
  const gates = useGates();
  const litTotal = ROOMS.filter((r) => roomLit(r, all)).length;

  return (
    <section className="panel rooms-panel">
      <PanelHead label="Rooms" summary={litTotal ? `${litTotal} room${litTotal > 1 ? 's' : ''} lit` : 'All dark'} />
      <div className="room-rows">
        {ROOMS.map((r) => <RoomRow key={r.id} room={r} gates={gates} />)}
      </div>
    </section>
  );
}
