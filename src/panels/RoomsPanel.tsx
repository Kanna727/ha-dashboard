import { APPLIANCES, FAN_MANUAL_OFF, ROOMS, type RoomDef } from '../config/entities';
import { useHass } from '../ha/api';
import { useAllEntities, useEntities, useEntity } from '../ha/store';
import { fmtNum, fmtWatts, isOn, isUnavailable, num } from '../ha/format';
import { AppliancesCard } from '../components/AppliancesCard';
import { ClimateCard } from '../components/ClimateCard';
import { MediaCard } from '../components/MediaCard';
import { EntityTile } from '../components/EntityTile';
import { Icon, type IconName } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import type { HassEntities } from 'home-assistant-js-websocket';

const lightsOf = (r: RoomDef) => r.controls.filter((c) => c.entity.startsWith('light.')).map((c) => c.entity);
const roomLit = (r: RoomDef, all: HassEntities) => lightsOf(r).some((id) => all[id]?.state === 'on');

// Fans in the room whose "manual off" flag is on, i.e. automations won't turn them on.
function useHeldFans(room: RoomDef) {
  const fans = room.controls.filter((c) => FAN_MANUAL_OFF[c.entity]);
  const flags = useEntities(fans.map((c) => FAN_MANUAL_OFF[c.entity]));
  return fans.filter((_, i) => flags[i]?.state === 'on');
}

function RoomDetail({ room }: { room: RoomDef }) {
  const temp = useEntity(room.temperature);
  const hum = useEntity(room.humidity);
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
      {(temp || hum) && (
        <div className="stat-tiles two">
          {temp && <div className="stat-tile"><div className="label">Temperature</div><div className="stat-val">{fmtNum(temp, 1)}<small>°C</small></div></div>}
          {hum && <div className="stat-tile"><div className="label">Humidity</div><div className="stat-val">{fmtNum(hum)}<small>%</small></div></div>}
        </div>
      )}
      <div className="tiles roomy">{room.controls.map((c) => <EntityTile key={c.entity} {...c} />)}</div>
      {room.detailCards?.includes('climate') && <div className="detail-card"><ClimateCard /></div>}
      {room.detailCards?.includes('media') && <div className="detail-card"><MediaCard /></div>}
      {room.appliances && <div className="detail-card"><AppliancesCard /></div>}
    </div>
  );
}

// Washer / dishwasher status, shared by the room card buttons and subtitle.
function useApplianceStatus() {
  const washer = useEntity(APPLIANCES.washer.running);
  const washerPower = useEntity(APPLIANCES.washer.power);
  const dwState = useEntity(APPLIANCES.dishwasher.state);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress);
  const pct = num(dwProgress);
  const dwRunning = pct !== undefined && pct > 0 && pct < 100;
  return {
    washer: { running: washer?.state === 'on', text: washer?.state === 'on' ? `Washer ${fmtWatts(num(washerPower))}` : 'Washer idle' },
    dishwasher: {
      running: dwRunning,
      pct: dwRunning ? pct! : undefined,
      text: dwRunning ? `Dishwasher ${Math.round(pct!)}%` : isUnavailable(dwState) ? 'Dishwasher asleep' : 'Dishwasher idle',
    },
  };
}

function RoomRow({ room }: { room: RoomDef }) {
  const hass = useHass();
  const modal = useModal();
  const temp = useEntity(room.temperature);
  const hum = useEntity(room.humidity);
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
  const runningApps = (room.appliances ?? []).filter((a) => appStatus[a].running);
  // Dishwasher cycle progress, drawn as a read-only fill behind the card.
  const progress = room.appliances?.includes('dishwasher') ? appStatus.dishwasher.pct : undefined;

  // Climate first, then what's running: lights, running appliances, else the first other device that's on.
  const status: string[] = [];
  if (lit) status.push(`${lit} light${lit > 1 ? 's' : ''}`);
  runningApps.forEach((a) => status.push(appStatus[a].text));
  if (!status.length) status.push(others.length && !room.appliances ? `${others[0].name} on` : 'Off');
  const parts: string[] = [];
  if (temp) parts.push(`${fmtNum(temp, 0)}°`);
  if (hum) parts.push(`${fmtNum(hum)}%`);
  parts.push(...status);

  // The lights button always drives every light in the room together.
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
  const openDetail = () => modal.open({ title: room.name, icon: room.icon as IconName, accent: lit ? 'var(--accent-light)' : undefined, body: <RoomDetail room={room} /> });

  return (
    <div
      className={`room-row ${lit ? 'lit' : ''} ${held.length ? 'fan-held' : ''}`}
      role="button"
      tabIndex={0}
      onClick={openDetail}
    >
      {progress !== undefined && (
        <span className="room-row-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
      <div className="room-row-top">
        <span className="room-row-icon"><Icon name={room.icon as IconName} size={22} /></span>
        <span className="row-buttons">
          {room.appliances?.map((a) => (
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
            </button>
          ))}
          {room.quick && (
            <button
              className={`row-btn ${room.quick.kind} ${quickOn ? 'on' : ''}`}
              disabled={quickOffline}
              onClick={toggleQuick}
              aria-label={`${quickOn ? 'Turn off' : 'Turn on'} ${room.name} ${quickName}${quickHeld ? ' (manual override on)' : ''}`}
              title={quickHeld ? 'Manual override: automations will not turn this fan on' : undefined}
            >
              <Icon name={room.quick.kind === 'fan' ? 'fan' : 'geyser'} size={22} className={room.quick.kind === 'fan' && quickOn ? 'spin-y-icon' : undefined} />
              {quickHeld && <span className="hold-badge"><Icon name="lock" size={11} /></span>}
            </button>
          )}
          {lightIds.length > 0 && (
            <button className={`row-btn bulb ${lit ? 'on' : ''}`} onClick={toggleLights} aria-label={`${lit ? 'Turn off' : 'Turn on'} ${room.name} lights`}>
              <Icon name="lightOn" size={22} />
            </button>
          )}
        </span>
      </div>
      <span className="room-row-name">
        {room.name}
        {occupied && <span className="presence-dot" title="Someone's here" />}
        {doorOpen && <Icon name="doorOpen" size={14} className="door-warn" />}
      </span>
      <span className={`room-row-sub ${lit ? 'lit' : ''}`}>{parts.join(' · ')}</span>
      {held.length > 0 && (
        <span className="hold-note">{held.length > 1 ? 'Fans' : held[0].name.toLowerCase().includes('fan') ? held[0].name : `${held[0].name} fan`} on manual override</span>
      )}
    </div>
  );
}

export function RoomsPanel() {
  const all = useAllEntities();
  const litTotal = ROOMS.filter((r) => roomLit(r, all)).length;

  return (
    <section className="panel rooms-panel">
      <PanelHead label="Rooms" summary={litTotal ? `${litTotal} room${litTotal > 1 ? 's' : ''} lit` : 'All dark'} />
      <div className="room-rows">
        {ROOMS.map((r) => <RoomRow key={r.id} room={r} />)}
      </div>
    </section>
  );
}
