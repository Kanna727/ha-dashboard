import { APPLIANCES, CAR } from '../config/entities';
import { Icon, type IconName } from '../components/Icon';
import { PanelHead } from '../components/Modal';
import { isUnavailable } from '../ha/format';
import { useEntities } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { usePage, type Page } from '../layout/pages';
import { showOnClean } from '../layout/CleanPage';
import { isNight, washerDone } from '../lib/attention';
import { useIssues } from './useIssues';
import { daysUntil } from '../lib/finance';
import { useFinance } from '../money/useFinance';
import { lowText } from '../lib/medicines';
import { useMedicines, whoseName } from '../medicines/useMedicines';

interface Item {
  id: string;
  icon: IconName;
  text: string;
  tone: 'warn' | 'info' | 'done';
  page?: Page;
}

const ICONS: Record<string, IconName> = { wan: 'wifiOff', rain: 'umbrella' };
const iconOf = (id: string): IconName =>
  ICONS[id] ?? (id.includes('purifier') ? 'purifier' : id.includes('fridge') ? 'fridge' : id.includes('washing_machine') ? 'washer' : 'doorOpen');
const ago = (t: number, now: number) => {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

// Everything that wants someone's attention, most urgent first: the header's
// issues (internet down, doors open, purifier faults, rain coming; not the
// offline devices, which are always a few), plus laundry left in the washer,
// the dishwasher finished or stuck, the car unlocked at night, and medicines
// about to run out.
function useAttention(): Item[] {
  const now = useNow(60_000);
  const issues = useIssues();
  const dw = APPLIANCES.dishwasher;
  const [running, door, dwState, lock] = useEntities([APPLIANCES.washer.running, APPLIANCES.washer.door, dw.state, CAR.lock]);
  const bill = useFinance()?.bill;
  const meds = useMedicines();
  const items: Item[] = issues
    .filter((i) => i.id !== 'offline')
    .map((i) => ({ id: i.id, icon: iconOf(i.id), text: i.text, tone: i.severity, page: i.id === 'rain' ? ('commute' as const) : undefined }));
  if (lock?.state === 'unlocked' && isNight(now)) items.push({ id: 'car', icon: 'unlock', text: `${CAR.name} is unlocked`, tone: 'warn', page: 'commute' });
  const s = dwState && !isUnavailable(dwState) ? dwState.state.replace(/^.*\./, '').toLowerCase() : '';
  if (s === 'actionrequired' || s === 'error') items.push({ id: 'dw', icon: 'dishwasher', text: 'Dishwasher needs attention', tone: 'warn', page: 'clean' });
  // A card bill due within 3 days (no amount: the wall screen is seen by anyone in the room).
  const billDays = bill?.due ? daysUntil(bill.due, now) : undefined;
  if (billDays !== undefined && billDays <= 3) {
    const when = billDays < 0 ? 'was due' : billDays === 0 ? 'due today' : billDays === 1 ? 'due tomorrow' : `due in ${billDays} days`;
    items.push({ id: 'bill', icon: 'creditCard', text: `${bill!.card ? `${bill!.card} bill` : 'Card bill'} ${when}`, tone: 'warn', page: 'money' });
  }
  // Medicines running out within MEDICINES.lowDays (default 5), soonest first.
  for (const m of meds.low) items.push({ id: `med:${m.med.id}`, icon: 'pill', text: lowText(m, now, whoseName(m, meds.list)), tone: 'warn', page: 'health' });
  const washed = washerDone(running, door, now.getTime());
  if (washed !== null) items.push({ id: 'washer', icon: 'washer', text: `Washer done ${ago(washed, now.getTime())}`, tone: 'done' });
  if (s === 'finished') items.push({ id: 'dw', icon: 'dishwasher', text: 'Dishwasher finished', tone: 'done', page: 'clean' });
  const rank = { warn: 0, done: 1, info: 2 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

const SHOWN = 2;

// The Home page's "Needs attention" panel, readable from across the room
// (the owner asked on 2026-10-26 for the glance page to show what needs doing):
// up to two items in large type, orange for problems, green for chores that
// are done, blue for heads-ups, or a green "All clear".
export function AttentionPanel() {
  const items = useAttention();
  const [, go] = usePage();
  const more = items.length - SHOWN;
  return (
    <section className={`panel attention-panel ${items.length ? '' : 'clear'}`}>
      <PanelHead label="Needs attention" summary={more > 0 ? `+${more} more` : undefined} />
      {!items.length ? (
        <div className="att-clear">
          <Icon name="tick" size={30} />
          <span>All clear</span>
        </div>
      ) : (
        <ul className="att-list">
          {items.slice(0, SHOWN).map((it) => (
            <li key={it.id}>
              <button
                className={`att-item ${it.tone}`}
                disabled={!it.page}
                onClick={() => {
                  if (it.page === 'clean') showOnClean('dishwasher');
                  if (it.page) go(it.page);
                }}
              >
                <Icon name={it.icon} size={28} />
                <span>{it.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
