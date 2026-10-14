import { useState } from 'react';
import { MUSIC_PLAYERS } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntities } from '../ha/store';
import { isUnavailable } from '../ha/format';
import { Icon } from '../components/Icon';
import { cycle, useSwipe } from '../hooks/useSwipe';

// Media players expose these bits in supported_features.
const PREV = 16;
const NEXT = 32;

// Indices of players that are playing, then paused ones (config order within each).
export function activePlayers(players: ({ state: string } | undefined)[]): number[] {
  const of = (state: string) => players.flatMap((p, i) => (p?.state === state ? [i] : []));
  return [...of('playing'), ...of('paused')];
}

export function PlayerDots({ count, index }: { count: number; index: number }) {
  if (count < 2) return null;
  return (
    <span className="player-dots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i === index ? 'on' : ''} />
      ))}
    </span>
  );
}

// Player controls, shown in the popup opened from the top-bar now-playing pill.
// Swipe sideways to move between players that are playing or paused.
export function MusicPlayer({ initial }: { initial?: number }) {
  const hass = useHass();
  const players = useEntities(MUSIC_PLAYERS.map((p) => p.entity));
  const active = activePlayers(players);
  // A chip tap or swipe sticks while the popup is open; until then follow the active player.
  const [picked, setPicked] = useState<number | null>(initial ?? null);
  const idx = picked ?? (active.length ? active[0] : 0);
  const swipe = useSwipe((dir) => active.length > 1 && setPicked(cycle(active, idx, dir)));
  const player = players[idx];
  const def = MUSIC_PLAYERS[idx];
  const playing = player?.state === 'playing';
  const a = player?.attributes ?? {};
  const features = (a.supported_features as number | undefined) ?? 0;
  const art = a.entity_picture as string | undefined;
  const title = a.media_title as string | undefined;
  const artist = (a.media_artist as string | undefined) ?? (a.app_name as string | undefined);
  const target = { entity_id: def.entity };
  const offline = isUnavailable(player);

  return (
    <div className="music-player" {...swipe}>
      <div className="music-body">
        <div className={`vinyl ${playing ? 'spin' : ''}`}>
          <div className="vinyl-label" style={art ? { backgroundImage: `url(${art})` } : undefined}>
            {!art && <Icon name="music" size={26} />}
          </div>
        </div>
        <div className="music-info">
          <div className="music-title ellipsis">{title ?? (offline ? `${def.name} offline` : 'Nothing playing')}</div>
          <div className="muted ellipsis">{title ? artist ?? def.name : 'Ask Alexa or pick a speaker'}</div>
          <div className="chips-row">
            {MUSIC_PLAYERS.map((p, i) => (
              <button
                key={p.entity}
                className={`chip-btn small ${i === idx ? 'active' : ''}`}
                disabled={isUnavailable(players[i])}
                onClick={() => setPicked(i)}
              >
                <Icon name="speaker" size={12} /> {p.name}
              </button>
            ))}
          </div>
          <div className="music-controls">
            <button className="round" disabled={offline || !(features & PREV)} onClick={() => hass.callService('media_player', 'media_previous_track', {}, target)} aria-label="Previous">
              <Icon name="prev" />
            </button>
            <button className="round play" disabled={offline} onClick={() => hass.callService('media_player', 'media_play_pause', {}, target)} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={30} />
            </button>
            <button className="round" disabled={offline || !(features & NEXT)} onClick={() => hass.callService('media_player', 'media_next_track', {}, target)} aria-label="Next">
              <Icon name="next" />
            </button>
          </div>
        </div>
      </div>
      <PlayerDots count={active.length} index={active.indexOf(idx)} />
    </div>
  );
}
