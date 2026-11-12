// The mock medicines document (the hidden 'dashboard-medicines' dashboard), as
// the dashboard would have saved it: fictional medicines for the example's two
// people, counted an hour ago, so Omega-3 runs out within days, the probiotic
// has run out and the iron is paused.
import { medicinesDoc, type MedicineDef } from '../src/lib/medicines';

export function mockMedicines() {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  const list: MedicineDef[] = [
    { id: 'omega3', name: 'Omega-3', who: ['a'], doses: { after_lunch: 1, after_dinner: 1 }, unit: 'capsule', pack: 30, count: 7 },
    { id: 'vitamin_d3', name: 'Vitamin D3', who: ['a', 's'], doses: { after_breakfast: 1 }, days: [0], unit: 'capsule', pack: 8, count: 6 },
    { id: 'iron', name: 'Iron', who: ['s'], doses: { before_breakfast: 1 }, pack: 15, count: 24, paused: true, note: 'Empty stomach, with water. No tea for an hour.' },
    { id: 'magnesium', name: 'Magnesium', who: ['a'], doses: { after_dinner: 1 }, pack: 30, count: 40 },
    { id: 'probiotic', name: 'Probiotic', who: ['s'], doses: { before_dinner: 1 }, unit: 'capsule', pack: 10, count: 0 },
    { id: 'folic_acid', name: 'Folic acid', who: ['s'], doses: { after_breakfast: 0.5 }, count: null },
  ];
  return medicinesDoc(list.map((m) => ({ ...m, countedAt: at })));
}
