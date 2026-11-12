import type { ReactNode } from 'react';
import { ArrangeProvider, FreeCanvas, type CardDef } from './Canvas';
import { LiveUpdates } from '../components/LiveUpdates';
import { BatteriesPanel } from '../panels/BatteriesPanel';
import { CarDrivingPanel, CarPanel } from '../panels/CarPanel';
import { CommutePanel } from '../panels/CommutePanel';
import { EnergyHistoryPanel } from '../panels/EnergyHistoryPanel';
import { EnergyPanel } from '../panels/EnergyPanel';
import { AttentionPanel } from '../panels/AttentionPanel';
import { GlancePanel } from '../panels/GlancePanel';
import { HealthPanel } from '../panels/HealthPanel';
import { MealsPanel } from '../panels/MealsPanel';
import { MedicinesPanel } from '../medicines/MedicinesPanel';
import { NetworkDevicesPanel, NetworkPanel } from '../panels/NetworkPanel';
import { RoomsPanel } from '../panels/RoomsPanel';
import { TopBar } from '../panels/TopBar';
import { WeatherPanel } from '../panels/WeatherPanel';
import { BillPanel, CardsPanel, InvestmentsPanel, MoneySummary, PassbookPanel, ScoresPanel, SpendPanel } from '../money/MoneyPanels';
import { useHasMoney } from '../money/useFinance';
import { NetWorthPanel } from '../money/MoneyCharts';
import { BalanceSheetPanel, EpfPanel, FundsPanel, InsurancePanel, StocksPanel, TransactionsPanel } from '../money/MoneyDetails';
import { useMoneySection, type MoneySection } from '../money/sections';
import { MoneyStrip, MoneyTiles } from '../money/MoneyTiles';
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
      return { className: 'cols cols-2', columns: [[card('health', <HealthPanel full />)], [card('medicines', <MedicinesPanel full />), card('meals', <MealsPanel full />)]] };
    case 'money':
      return moneyColumns('overview');
  }
}

// The Money page's cards by section (money/sections.tsx), for tablet and desktop.
function moneyColumns(section: MoneySection): { className: string; columns: CardDef[][] } {
  switch (section) {
    case 'overview':
      return {
        className: 'cols cols-money',
        columns: [
          [card('moneySummary', <MoneySummary />), card('networth', <NetWorthPanel />), card('balance', <BalanceSheetPanel />)],
          [card('bill', <BillPanel />)],
        ],
      };
    case 'spending':
      return {
        className: 'cols cols-2',
        columns: [[card('spend', <SpendPanel />), card('passbook', <PassbookPanel />)], [card('transactions', <TransactionsPanel />)]],
      };
    case 'cards':
      return { className: 'cols cols-money', columns: [[card('cards', <CardsPanel />)], [card('scores', <ScoresPanel />)]] };
    case 'insurance':
      return { className: 'cols cols-insurance', columns: [[card('insurance', <InsurancePanel />)]] };
    case 'invest':
      return {
        className: 'cols cols-2',
        columns: [
          [card('investments', <InvestmentsPanel />), card('funds', <FundsPanel />)],
          [card('epf', <EpfPanel />), card('stocks', <StocksPanel />)],
        ],
      };
  }
}

// The Money page: the tiles, or a section's cards under the strip of small
// tiles. Each section is arranged on its own (canvas page `money:<section>`).
function MoneyWide({ kind }: { kind: 'tablet' | 'desktop' }) {
  const section = useMoneySection();
  if (!section) return <MoneyTiles />;
  const page = `money:${section}`;
  return (
    <>
      <MoneyStrip />
      <FreeCanvas key={page} name={kind} page={page} {...moneyColumns(section)} />
    </>
  );
}

function MoneyPhone() {
  const section = useMoneySection();
  if (!section) return <MoneyTiles />;
  return (
    <>
      <MoneyStrip />
      {section === 'overview' && (
        <>
          <MoneySummary />
          <BillPanel />
          <NetWorthPanel />
          <BalanceSheetPanel />
        </>
      )}
      {section === 'spending' && (
        <>
          <SpendPanel />
          <TransactionsPanel />
          <PassbookPanel />
        </>
      )}
      {section === 'cards' && (
        <>
          <CardsPanel />
          <ScoresPanel />
        </>
      )}
      {section === 'insurance' && <InsurancePanel />}
      {section === 'invest' && (
        <>
          <InvestmentsPanel />
          <FundsPanel />
          <StocksPanel />
          <EpfPanel />
        </>
      )}
    </>
  );
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
          render={(p) =>
            p === 'clean' ? <CleanPage /> : p === 'money' ? <MoneyWide kind={kind} /> : <FreeCanvas key={p} name={kind} page={p} {...pageColumns(p, kind === 'desktop')} />
          }
        />
        <LiveUpdates />
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
  medicines: 'Medicines',
  energyHistory: 'Energy history',
  health: 'Health',
  network: 'Network',
  batteries: 'Batteries',
  networkDevices: 'Connected devices',
  driving: 'Driving',
  glance: 'At a glance',
  attention: 'Needs attention',
  moneySummary: 'Money',
  networth: 'Net worth',
  cards: 'Credit cards',
  passbook: 'Passbook',
  bill: 'Bills',
  scores: 'Credit score',
  investments: 'Investments',
  spend: 'Spending',
  balance: 'Own and owe',
  transactions: 'Transactions',
  funds: 'Mutual funds',
  stocks: 'Stocks',
  epf: 'EPF',
  insurance: 'Insurance',
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
          <MedicinesPanel />
          <MealsPanel />
        </>
      )}
      {page === 'money' && <MoneyPhone />}
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
      <LiveUpdates />
      <TabBar pages={pages} current={page} onSelect={(p) => go(p)} />
    </div>
  );
}
