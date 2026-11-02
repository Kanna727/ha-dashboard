import { PanelHead } from '../components/Modal';
import { CleanTile } from '../layout/CleanPage';
import { BatteriesTile } from './BatteriesPanel';
import { CarTile } from './CarPanel';
import { CommuteTile } from './CommutePanel';
import { EnergyTile } from './EnergyPanel';
import { HealthTile } from './HealthPanel';
import { MealTile } from './MealsPanel';
import { NetworkTile } from './NetworkPanel';
import { WeatherTile } from './WeatherPanel';
import { MoneyTile } from '../money/MoneyPanels';

// The Home page's "At a glance" panel (the owner asked on 2026-10-26 for Home
// to be the wall tablet's glance page, showing as much as it usefully can):
// one tile per page's headline, each opening its page. A tile with nothing to
// show (no car, no commute, ...) leaves itself out.
export function GlancePanel() {
  return (
    <section className="panel glance-panel">
      <PanelHead label="At a glance" />
      <div className="glance-grid">
        <WeatherTile />
        <CommuteTile />
        <EnergyTile />
        <CarTile />
        <NetworkTile />
        <BatteriesTile />
        <MealTile />
        <CleanTile />
        <HealthTile />
        <MoneyTile />
      </div>
    </section>
  );
}
