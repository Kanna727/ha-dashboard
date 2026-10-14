import { MEDIA } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntity } from '../ha/store';
import { isUnavailable, stateLabel } from '../ha/format';
import { Icon } from './Icon';

function MediaRow({ entity, name }: { entity: string; name: string }) {
  const hass = useHass();
  const e = useEntity(entity);
  const offline = isUnavailable(e);
  const off = !e || e.state === 'off' || e.state === 'standby';
  const playing = e?.state === 'playing';
  const title = (e?.attributes.media_title as string | undefined) ?? (e?.attributes.app_name as string | undefined);
  const target = { entity_id: entity };

  return (
    <div className={`media-row ${playing ? 'playing' : ''}`}>
      <Icon name="tv" size={22} />
      <div className="media-info">
        <div>{name}</div>
        <div className="muted small ellipsis">{offline ? 'Offline' : title ?? stateLabel(e)}</div>
      </div>
      {!offline && !off && (
        <button className="round small" aria-label={playing ? 'Pause' : 'Play'} onClick={() => hass.callService('media_player', 'media_play_pause', {}, target)}>
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
      )}
      {!offline && (
        <button
          className={`round small ${off ? '' : 'active'}`}
          aria-label={off ? 'Turn on' : 'Turn off'}
          onClick={() => hass.callService('media_player', off ? 'turn_on' : 'turn_off', {}, target)}
        >
          <Icon name="power" size={18} />
        </button>
      )}
    </div>
  );
}

export function MediaCard() {
  return (
    <section className="card media">
      <header className="card-head"><Icon name="tv" size={18} /><h2>Media</h2></header>
      {MEDIA.map((m) => <MediaRow key={m.entity} {...m} />)}
    </section>
  );
}
