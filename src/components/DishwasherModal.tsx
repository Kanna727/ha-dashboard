import type { ModalSpec } from './Modal';
import { useDishwasher } from './dishwasher/useDishwasher';
import { PanelLayout } from './dishwasher/PanelLayout';

// Everything for the dishwasher in one place: the 3D model, its control panel,
// status, care and power use (data and actions: useDishwasher).
export function DishwasherDetail() {
  return <PanelLayout dw={useDishwasher()} />;
}

// Opens the dishwasher modal (from the room card's chip or the Appliances card).
export function openDishwasher(modal: { open: (m: ModalSpec) => void }) {
  modal.open({ title: 'Dishwasher', icon: 'dishwasher', accent: '#2dd4bf', wide: true, body: <DishwasherDetail /> });
}
