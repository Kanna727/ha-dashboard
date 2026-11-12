// The medicines, kept in the hidden MEDICINES.store dashboard (created on the
// first save) and followed live on every screen, with what's left of each, the
// day's doses and which ones run out soon. Shared by the panel and "Needs attention".
import { useCallback, useMemo } from 'react';
import { MEDICINES } from '../config/entities';
import { useNow } from '../hooks/useNow';
import { doseStates, medicinesDoc, parseMedicines, shownDay, stockStatus, timesOf, type MedicineDef, type StockStatus } from '../lib/medicines';
import { useSaveStoreDoc, useStoreDoc } from '../money/useMoneyHistory';

export const MED_TIMES = timesOf(MEDICINES.times);

export function useMedicineList(): MedicineDef[] {
  const doc = useStoreDoc(MEDICINES.store, 'Medicines');
  return useMemo(() => parseMedicines(doc), [doc]);
}

export function useMedicines() {
  const now = useNow(60_000);
  const list = useMedicineList();
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    const stock: StockStatus[] = list.map((m) => stockStatus(m, now, MED_TIMES, MEDICINES.lowDays));
    const day = shownDay(list, now, MED_TIMES);
    const low = stock.filter((s) => s.low).sort((a, b) => (a.out?.getTime() ?? 0) - (b.out?.getTime() ?? 0));
    return { now, list, stock, day, doses: doseStates(day.slots, now), low };
  }, [minute, list]);
}

// Saves a change to the list. `change` gets the list as stored right now (re-read
// first), so two screens editing different medicines don't undo each other.
// Needs an admin login (HA's lovelace/config/save).
export function useSaveMedicines(): (change: (list: MedicineDef[]) => MedicineDef[]) => Promise<void> {
  const save = useSaveStoreDoc(MEDICINES.store, 'Medicines', 'Medicines');
  return useCallback((change) => save((current) => medicinesDoc(change(parseMedicines(current)))), [save]);
}

// A person's name for the "Needs attention" text, only when the medicine's
// name alone doesn't say whose it is (two entries with the same name).
export function whoseName(s: StockStatus, list: MedicineDef[]): string | undefined {
  const twin = list.some((m) => m.id !== s.med.id && m.name.toLowerCase() === s.med.name.toLowerCase());
  if (!twin || s.med.who.length !== 1) return undefined;
  return MEDICINES.people.find((p) => p.id === s.med.who[0])?.name;
}

export const personIndex = (id: string) => MEDICINES.people.findIndex((p) => p.id === id);
