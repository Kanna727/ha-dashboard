import { useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { CarPanel } from '../panels/CarPanel';
import { CommutePanel } from '../panels/CommutePanel';
import { EnergyPanel } from '../panels/EnergyPanel';
import { MealsPanel } from '../panels/MealsPanel';
import { RoomsPanel } from '../panels/RoomsPanel';
import { TopBar } from '../panels/TopBar';
import { WeatherPanel } from '../panels/WeatherPanel';

// iPad kiosk: three columns that each scroll on their own, page never scrolls.
export function TabletLayout() {
  return (
    <div className="layout tablet">
      <TopBar />
      <main className="cols cols-3">
        <div className="col">
          <EnergyPanel />
          <WeatherPanel />
        </div>
        <div className="col">
          <RoomsPanel />
        </div>
        <div className="col">
          <CarPanel />
          <CommutePanel />
          <MealsPanel />
        </div>
      </main>
    </div>
  );
}

export function DesktopLayout() {
  return (
    <div className="layout desktop">
      <TopBar />
      <main className="cols cols-4">
        <div className="col">
          <EnergyPanel />
          <WeatherPanel days={7} />
        </div>
        <div className="col">
          <RoomsPanel />
        </div>
        <div className="col">
          <CommutePanel />
          <MealsPanel />
        </div>
        <div className="col">
          <CarPanel />
        </div>
      </main>
    </div>
  );
}

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
