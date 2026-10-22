import { useState, type ReactNode } from 'react';
import { ArrangeProvider, FreeCanvas, type CardDef } from './Canvas';
import { Icon, type IconName } from '../components/Icon';
import { CarPanel } from '../panels/CarPanel';
import { CommutePanel } from '../panels/CommutePanel';
import { EnergyPanel } from '../panels/EnergyPanel';
import { MealsPanel } from '../panels/MealsPanel';
import { RoomsPanel } from '../panels/RoomsPanel';
import { TopBar } from '../panels/TopBar';
import { WeatherPanel } from '../panels/WeatherPanel';
import { VacuumPage } from '../vacuum/VacuumPage';
import { useVacuumId } from '../vacuum/useVacuum';
import { usePage, type Page } from './pages';
import { Pager } from './Pager';

// The pages tablet and desktop swipe between: the home dashboard, then the vacuum.
function usePages(): Page[] {
  return useVacuumId() ? ['home', 'vacuum'] : ['home'];
}

// Tablet and desktop: the cards start in columns and can be arranged freely
// (Canvas.tsx). iPad kiosk: the page never scrolls; the columns, or the
// canvas, scroll inside it.
export function TabletLayout() {
  const [page, go] = usePage();
  const pages = usePages();
  return (
    <ArrangeProvider>
      <div className="layout tablet">
        <TopBar />
        <Pager
          pages={pages}
          current={page}
          onChange={(p) => go(p, true)}
          render={(p) =>
            p === 'vacuum' ? (
              <VacuumPage onBack={() => go('home')} />
            ) : (
              <FreeCanvas
                name="tablet"
                className="cols cols-3"
                columns={[
                  [card('energy', <EnergyPanel />), card('weather', <WeatherPanel />)],
                  [card('rooms', <RoomsPanel />)],
                  [card('car', <CarPanel />), card('commute', <CommutePanel />), card('meals', <MealsPanel />)],
                ]}
              />
            )
          }
        />
      </div>
    </ArrangeProvider>
  );
}

export function DesktopLayout() {
  const [page, go] = usePage();
  const pages = usePages();
  return (
    <ArrangeProvider>
      <div className="layout desktop">
        <TopBar />
        <Pager
          pages={pages}
          current={page}
          onChange={(p) => go(p, true)}
          render={(p) =>
            p === 'vacuum' ? (
              <VacuumPage onBack={() => go('home')} />
            ) : (
              <FreeCanvas
                name="desktop"
                className="cols cols-4"
                columns={[
                  [card('energy', <EnergyPanel />), card('weather', <WeatherPanel days={7} />)],
                  [card('rooms', <RoomsPanel />)],
                  [card('commute', <CommutePanel />), card('meals', <MealsPanel />)],
                  [card('car', <CarPanel />)],
                ]}
              />
            )
          }
        />
      </div>
    </ArrangeProvider>
  );
}

const LABELS: Record<string, string> = {
  energy: 'Energy',
  weather: 'Weather',
  rooms: 'Rooms',
  car: 'Car',
  commute: 'Commute',
  meals: 'Meals',
};
const card = (id: keyof typeof LABELS, node: ReactNode): CardDef => ({ id, label: LABELS[id], node });

type Tab = 'home' | 'energy' | 'travel' | 'more';
type TabId = Tab | 'vacuum';
const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'energy', label: 'Energy', icon: 'flash' },
  { id: 'travel', label: 'Travel', icon: 'car' },
  { id: 'vacuum', label: 'Vacuum', icon: 'vacuum' },
  { id: 'more', label: 'More', icon: 'music' },
];

function PhoneTab({ tab }: { tab: TabId }) {
  return (
    <div className="phone-body">
      {tab === 'home' && <RoomsPanel />}
      {tab === 'energy' && (
        <>
          <EnergyPanel />
          <WeatherPanel days={5} />
        </>
      )}
      {tab === 'travel' && (
        <>
          <CarPanel />
          <CommutePanel />
        </>
      )}
      {tab === 'vacuum' && <VacuumPage />}
      {tab === 'more' && <MealsPanel />}
    </div>
  );
}

export function PhoneLayout() {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('dashTab') as Tab) || 'home');
  // The vacuum is a page of its own (#vacuum), shown as a tab here when the home has one.
  const [page, go] = usePage();
  const hasVacuum = !!useVacuumId();
  const current: TabId = page === 'vacuum' ? 'vacuum' : tab;
  const tabs = TABS.filter((t) => t.id !== 'vacuum' || hasVacuum);
  // `swiped`: the pager lines the page up itself, so don't jump to the top.
  const select = (t: TabId, swiped = false) => {
    if (t === 'vacuum') return go('vacuum', swiped);
    sessionStorage.setItem('dashTab', t);
    setTab(t);
    if (page !== 'home') go('home', swiped);
    if (!swiped) window.scrollTo({ top: 0 });
  };

  return (
    <div className="layout phone">
      <TopBar compact />
      <Pager pages={tabs.map((t) => t.id)} current={current} onChange={(t) => select(t, true)} render={(t) => <PhoneTab tab={t} />} />
      <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => (
          <button key={t.id} className={current === t.id ? 'active' : ''} onClick={() => select(t.id)}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
