import { APPLIANCES, type RoomDef } from '../config/entities';
import { useEntity } from '../ha/store';
import { fmtWatts, isUnavailable, num, stateLabel } from '../ha/format';
import { Icon } from './Icon';
import { openDishwasher } from './DishwasherModal';
import { useModal } from './Modal';
import { PurifierRow } from './PurifierRow';

type Kind = NonNullable<RoomDef['appliances']>[number];

function timeOf(iso: string | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function DishwasherRow() {
  const dwState = useEntity(APPLIANCES.dishwasher.state);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress);
  const dwFinish = useEntity(APPLIANCES.dishwasher.finish);
  const modal = useModal();
  const progress = num(dwProgress);
  const dwRunning = progress !== undefined && progress > 0 && progress < 100;
  return (
    <div className={`appliance tappable ${dwRunning ? 'running' : ''}`} role="button" tabIndex={0} onClick={() => openDishwasher(modal)}>
      <Icon name="dishwasher" size={22} />
      <div className="app-body">
        <div className="app-title">
          Dishwasher
          <span className="muted small">{isUnavailable(dwState) ? 'Asleep' : stateLabel(dwState)}</span>
        </div>
        {dwRunning && (
          <>
            <div className="progress"><i style={{ width: `${progress}%` }} /></div>
            <div className="muted small">{Math.round(progress!)}% · done {timeOf(dwFinish?.state)}</div>
          </>
        )}
      </div>
    </div>
  );
}

function WasherRow() {
  const wmRunning = useEntity(APPLIANCES.washer.running);
  const wmPower = useEntity(APPLIANCES.washer.power);
  const wmDoor = useEntity(APPLIANCES.washer.door);
  const washing = wmRunning?.state === 'on';
  return (
    <div className={`appliance ${washing ? 'running' : ''}`}>
      <Icon name="washer" size={22} className={washing ? 'wobble' : ''} />
      <div className="app-body">
        <div className="app-title">
          Washing machine
          <span className="muted small">{washing ? `Running · ${fmtWatts(num(wmPower))}` : wmDoor?.state === 'on' ? 'Door open' : 'Idle'}</span>
        </div>
      </div>
    </div>
  );
}

// Fixed display order (the dishwasher has always come first).
const ROWS: [Kind, (props: { showName?: boolean }) => JSX.Element | null][] = [
  ['dishwasher', DishwasherRow],
  ['washer', WasherRow],
  ['purifier', PurifierRow],
];

// The room's appliances (RoomDef.appliances).
export function AppliancesCard({ kinds }: { kinds: Kind[] }) {
  const shown = ROWS.filter(([k]) => kinds.includes(k) && (k !== 'purifier' || APPLIANCES.purifier));
  if (!shown.length) return null;
  const single = shown.length === 1 ? shown[0][0] : undefined;
  const title = single === 'purifier' ? (APPLIANCES.purifier?.name ?? 'Water purifier') : 'Appliances';
  return (
    <section className="card appliances">
      <header className="card-head"><Icon name={single ?? 'washer'} size={18} /><h2>{title}</h2></header>
      {/* A lone purifier already has its name in the card header. */}
      {shown.map(([k, Row]) => <Row key={k} showName={!single} />)}
    </section>
  );
}
