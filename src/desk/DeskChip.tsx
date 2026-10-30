import { useModal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { displayHeight, isStanding } from '../lib/desk';
import { DeskArt } from './DeskArt';
import { DeskDetail, DeskSubtitle } from './DeskDetail';
import { useDeskIds, useDeskLive, usePresetHeights } from './useDesk';

// The desk in its room's popup: a line with its height that opens the desk's popup.
export function DeskRow() {
  const ids = useDeskIds();
  const live = useDeskLive(ids);
  const { line } = usePresetHeights(ids, live);
  const modal = useModal();
  if (!ids) return null;
  const standing = isStanding(live.height, line);
  return (
    <button className="detail-card desk-row" onClick={() => openDesk(modal.open)}>
      <DeskArt height={live.height} min={live.min} max={live.max} size={40} />
      <span className="desk-row-text">
        <strong>Desk</strong>
        <span className="muted">
          {live.offline ? 'Offline' : `${displayHeight(live.height)} cm · ${live.moving ? (live.moving === 'up' ? 'rising' : 'lowering') : standing ? 'standing height' : 'sitting height'}`}
        </span>
      </span>
      <Icon name="chevronRight" size={22} />
    </button>
  );
}

export function openDesk(open: ReturnType<typeof useModal>['open']) {
  open({ title: 'Desk', icon: 'desk', accent: 'var(--accent-desk)', wide: true, subtitle: <DeskSubtitle />, body: <DeskDetail /> });
}

// The desk's chip on a room card (RoomDef.appliances 'desk'): a little desk
// at the current height (icon only, the card is narrow); while it moves it lights up
// with an arrow. A tap opens the desk's popup.
export function DeskChip() {
  const ids = useDeskIds();
  const live = useDeskLive(ids);
  // Mounted on the card all the time, so the preset heights are learned even with the popup closed.
  const { line } = usePresetHeights(ids, live);
  const modal = useModal();
  if (!ids) return null;
  const standing = isStanding(live.height, line);
  const long = live.offline
    ? 'Desk offline'
    : `Desk ${live.moving ? (live.moving === 'up' ? 'rising' : 'lowering') : standing ? 'at standing height' : 'at sitting height'}, ${displayHeight(live.height)} cm`;
  return (
    <button
      className={`row-btn desk ${live.moving ? 'on' : ''} ${standing && !live.moving ? 'standing' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        openDesk(modal.open);
      }}
      aria-label={`${long}. Open the desk`}
      title={long}
    >
      {live.moving ? <Icon name={live.moving === 'up' ? 'raise' : 'lower'} size={20} className="desk-moving" /> : <DeskArt height={live.height} min={live.min} max={live.max} />}
    </button>
  );
}
