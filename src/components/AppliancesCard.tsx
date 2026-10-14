import { APPLIANCES } from '../config/entities';
import { useEntity } from '../ha/store';
import { fmtWatts, isUnavailable, num, stateLabel } from '../ha/format';
import { Icon } from './Icon';

function timeOf(iso: string | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function AppliancesCard() {
  const dwState = useEntity(APPLIANCES.dishwasher.state);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress);
  const dwFinish = useEntity(APPLIANCES.dishwasher.finish);
  const wmRunning = useEntity(APPLIANCES.washer.running);
  const wmPower = useEntity(APPLIANCES.washer.power);
  const wmDoor = useEntity(APPLIANCES.washer.door);

  const progress = num(dwProgress);
  const dwRunning = progress !== undefined && progress > 0 && progress < 100;
  const washing = wmRunning?.state === 'on';

  return (
    <section className="card appliances">
      <header className="card-head"><Icon name="washer" size={18} /><h2>Appliances</h2></header>
      <div className={`appliance ${dwRunning ? 'running' : ''}`}>
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
      <div className={`appliance ${washing ? 'running' : ''}`}>
        <Icon name="washer" size={22} className={washing ? 'wobble' : ''} />
        <div className="app-body">
          <div className="app-title">
            Washing machine
            <span className="muted small">{washing ? `Running · ${fmtWatts(num(wmPower))}` : wmDoor?.state === 'on' ? 'Door open' : 'Idle'}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
