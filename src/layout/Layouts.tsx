import type { ReactNode } from 'react';
import { ArrangeProvider, FreeCanvas, type CardDef } from './Canvas';
import { BatteriesPanel } from '../panels/BatteriesPanel';
import { CarDrivingPanel, CarPanel } from '../panels/CarPanel';
import { CommutePanel } from '../panels/CommutePanel';
import { EnergyHistoryPanel } from '../panels/EnergyHistoryPanel';
import { EnergyPanel } from '../panels/EnergyPanel';
import { AttentionPanel } from '../panels/AttentionPanel';
import { GlancePanel } from '../panels/GlancePanel';
import { HealthPanel } from '../panels/HealthPanel';
import { MealsPanel } from '../panels/MealsPanel';
import { NetworkDevicesPanel, NetworkPanel } from '../panels/NetworkPanel';
import { RoomsPanel } from '../panels/RoomsPanel';
import { TopBar } from '../panels/TopBar';
import { WeatherPanel } from '../panels/WeatherPanel';
import { BillPanel, CardsPanel, InvestmentsPanel, MoneySummary, PassbookPanel, ScoresPanel, SpendPanel } from '../money/MoneyPanels';
import { useHasMoney } from '../money/useFinance';
import { CleanPage, useHasClean } from './CleanPage';
import { PAGES, usePage, type Page } from './pages';
import { Pager } from './Pager';
import { TabBar } from './TabBar';

// The pages every layout swipes between and shows in the tab bar (pages.ts).
// Clean is left out when the home has neither a robot vacuum nor a dishwasher,
// Money when there are no finance helpers (lib/finance.ts).
function usePages() {
  const clean = useHasClean();
  const money = useHasMoney();
  return PAGES.filter((p) => (p.id !== 'clean' || clean) && (p.id !== 'money' || money));
}

// Each page's cards, in columns, for tablet and desktop. Weather shows a week on desktop.
function pageColumns(page: Exclude<Page, 'clean'>, desktop: boolean): { className: string; columns: CardDef[][] } {
  switch (page) {
    case 'home':
      return {
        className: 'cols cols-home',
        columns: [[card('rooms', <RoomsPanel />), card('attention', <AttentionPanel />)], [card('glance', <GlancePanel />)]],
      };
    case 'energy':
      return {
        className: 'cols cols-wide-mid',
        columns: [
          [card('energy', <EnergyPanel />), card('batteries', <BatteriesPanel />)],
          [card('energyHistory', <EnergyHistoryPanel full />)],
          [card('network', <NetworkPanel />), card('networkDevices', <NetworkDevicesPanel />)],
        ],
      };
    case 'commute':
      return {
        className: 'cols cols-wide-mid',
        columns: [
          [card('car', <CarPanel />), card('driving', <CarDrivingPanel />)],
          [card('commute', <CommutePanel full compact />)],
          [card('weather', <WeatherPanel days={desktop ? 7 : undefined} />)],
        ],
      };
    case 'health':
      return { className: 'cols cols-2', columns: [[card('health', <HealthPanel full />)], [card('meals', <MealsPanel full />)]] };
    case 'money':
      return {
        className: 'cols cols-money',
        columns: [
          [card('moneySummary', <MoneySummary />), card('cards', <CardsPanel />), card('passbook', <PassbookPanel />)],
          [card('bill', <BillPanel />), card('scores', <ScoresPanel />), card('investments', <InvestmentsPanel />), card('spend', <SpendPanel />)],
        ],
      };
  }
}

// Tablet and desktop: each page's cards start in columns and can be arranged
// freely (Canvas.tsx), each page on its own. iPad kiosk: the page never
// scrolls; the columns, or the canvas, scroll inside it.
function WideLayout({ kind }: { kind: 'tablet' | 'desktop' }) {
  const [page, go] = usePage();
  const pages = usePages();
  const ids = pages.map((p) => p.id);
  return (
    <ArrangeProvider>
      <div className={`layout ${kind}`}>
        <TopBar />
        <Pager
          pages={ids}
          current={page}
          onChange={(p) => go(p, true)}
          render={(p) => (p === 'clean' ? <CleanPage /> : <FreeCanvas key={p} name={kind} page={p} {...pageColumns(p, kind === 'desktop')} />)}
        />
        <TabBar pages={pages} current={page} onSelect={(p) => go(p)} />
      </div>
    </ArrangeProvider>
  );
}

export const TabletLayout = () => <WideLayout kind="tablet" />;
export const DesktopLayout = () => <WideLayout kind="desktop" />;

const LABELS: Record<string, string> = {
  energy: 'Energy',
  weather: 'Weather',
  rooms: 'Rooms',
  car: 'Car',
  commute: 'Commute',
  meals: 'Meals',
  energyHistory: 'Energy history',
  health: 'Health',
  network: 'Network',
  batteries: 'Batteries',
  networkDevices: 'Connected devices',
  driving: 'Driving',
  glance: 'At a glance',
  attention: 'Needs attention',
  moneySummary: 'Money',
  cards: 'Credit cards',
  passbook: 'Passbook',
  bill: 'Next card bill',
  scores: 'Credit score',
  investments: 'Investments',
  spend: 'Spending',
};
const card = (id: keyof typeof LABELS, node: ReactNode): CardDef => ({ id, label: LABELS[id], node });

function PhoneTab({ page }: { page: Page }) {
  return (
    <div className="phone-body">
      {page === 'home' && (
        <>
          <AttentionPanel />
          <GlancePanel />
          <RoomsPanel />
        </>
      )}
      {page === 'energy' && (
        <>
          <EnergyPanel />
          <EnergyHistoryPanel />
          <BatteriesPanel />
          <NetworkPanel />
        </>
      )}
      {page === 'commute' && (
        <>
          <CarPanel />
          <CommutePanel />
          <WeatherPanel days={5} />
        </>
      )}
      {page === 'health' && (
        <>
          <HealthPanel />
          <MealsPanel />
        </>
      )}
      {page === 'money' && (
        <>
          <MoneySummary />
          <BillPanel />
          <CardsPanel />
          <SpendPanel />
          <PassbookPanel />
          <InvestmentsPanel />
          <ScoresPanel />
        </>
      )}
      {page === 'clean' && <CleanPage />}
    </div>
  );
}

export function PhoneLayout() {
  const [page, go] = usePage();
  const pages = usePages();
  return (
    <div className="layout phone">
      <TopBar compact />
      {/* `true` on a swipe: the pager lines the page up itself, so don't jump to the top. */}
      <Pager pages={pages.map((p) => p.id)} current={page} onChange={(p) => go(p, true)} render={(p) => <PhoneTab page={p} />} />
      <TabBar pages={pages} current={page} onSelect={(p) => go(p)} />
    </div>
  );
}
