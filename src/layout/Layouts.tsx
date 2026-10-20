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

// Tablet and desktop: the cards start in columns and can be arranged freely
// (Canvas.tsx). iPad kiosk: the page never scrolls; the columns, or the
// canvas, scroll inside it.
export function TabletLayout() {
  return (
    <ArrangeProvider>
      <div className="layout tablet">
        <TopBar />
        <FreeCanvas
          name="tablet"
          className="cols cols-3"
          columns={[
            [card('energy', <EnergyPanel />), card('weather', <WeatherPanel />)],
            [card('rooms', <RoomsPanel />)],
            [card('car', <CarPanel />), card('commute', <CommutePanel />), card('meals', <MealsPanel />)],
          ]}
        />
      </div>
    </ArrangeProvider>
  );
}

export function DesktopLayout() {
  return (
    <ArrangeProvider>
      <div className="layout desktop">
        <TopBar />
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
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'energy', label: 'Energy', icon: 'flash' },
  { id: 'travel', label: 'Travel', icon: 'car' },
  { id: 'more', label: 'More', icon: 'music' },
];

export function PhoneLayout() {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('dashTab') as Tab) || 'home');
  const select = (t: Tab) => {
    sessionStorage.setItem('dashTab', t);
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="layout phone">
      <TopBar compact />
      <main className="phone-body">
        {tab === 'home' && (
          <>
            <RoomsPanel />
          </>
        )}
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
        {tab === 'more' && (
          <>
              <MealsPanel />
          </>
        )}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => select(t.id)}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
