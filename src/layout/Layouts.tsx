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
import { usePageSwipe } from './usePageSwipe';
import { stepPage } from '../lib/swipe';

// Tablet and desktop: the cards start in columns and can be arranged freely
// (Canvas.tsx). iPad kiosk: the page never scrolls; the columns, or the
// canvas, scroll inside it.
// Swipe between the pages tablet and desktop have (the home dashboard, then the vacuum).
function useSwipePages() {
  const [page, go] = usePage();
  const hasVacuum = !!useVacuumId();
  const pages: Page[] = hasVacuum ? ['home', 'vacuum'] : ['home'];
  const enter = usePageSwipe((dir) => {
    const next = stepPage(pages, page, dir);
    if (next) go(next);
    return !!next;
  });
  return { page, go, enter: enter ?? undefined };
}

export function TabletLayout() {
  const { page, go, enter } = useSwipePages();
  return (
    <ArrangeProvider>
      <div className="layout tablet" data-enter={enter}>
        <TopBar />
        {page === 'vacuum' ? (
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
        )}
      </div>
    </ArrangeProvider>
  );
}

export function DesktopLayout() {
  const { page, go, enter } = useSwipePages();
  return (
    <ArrangeProvider>
      <div className="layout desktop" data-enter={enter}>
        <TopBar />
        {page === 'vacuum' ? (
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
        )}
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
const TABS: { id: Tab | 'vacuum'; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'energy', label: 'Energy', icon: 'flash' },
  { id: 'travel', label: 'Travel', icon: 'car' },
  { id: 'vacuum', label: 'Vacuum', icon: 'vacuum' },
  { id: 'more', label: 'More', icon: 'music' },
];

export function PhoneLayout() {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('dashTab') as Tab) || 'home');
  // The vacuum is a page of its own (#vacuum), shown as a tab here when the home has one.
  const [page, go] = usePage();
  const hasVacuum = !!useVacuumId();
  const current = page === 'vacuum' ? 'vacuum' : tab;
  const tabs = TABS.filter((t) => t.id !== 'vacuum' || hasVacuum);
  const select = (t: Tab | 'vacuum') => {
    if (t === 'vacuum') return go('vacuum');
    sessionStorage.setItem('dashTab', t);
    setTab(t);
    if (page !== 'home') go('home');
    window.scrollTo({ top: 0 });
  };
  // Swipe left/right for the next/previous tab.
  const enter = usePageSwipe((dir) => {
    const next = stepPage(
      tabs.map((t) => t.id),
      current,
      dir,
    );
    if (next) select(next);
    return !!next;
  });

  return (
    <div className="layout phone" data-enter={enter ?? undefined}>
      <TopBar compact />
      <main className="phone-body">
        {current === 'home' && (
          <>
            <RoomsPanel />
          </>
        )}
        {current === 'energy' && (
          <>
            <EnergyPanel />
            <WeatherPanel days={5} />
          </>
        )}
        {current === 'travel' && (
          <>
            <CarPanel />
            <CommutePanel />
          </>
        )}
        {current === 'vacuum' && <VacuumPage />}
        {current === 'more' && (
          <>
              <MealsPanel />
          </>
        )}
      </main>
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
