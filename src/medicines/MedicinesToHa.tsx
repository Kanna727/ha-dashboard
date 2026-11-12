import { useEffect, useMemo, useRef } from 'react';
import { MEDICINES } from '../config/entities';
import { useHass, useHassStatus } from '../ha/api';
import { useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { HA_EVENT, HA_SENSOR, haSummary, parseMedicines } from '../lib/medicines';
import { useStoreDoc } from '../money/useMoneyHistory';
import { MED_TIMES } from './useMedicines';

const WAIT_MS = 5_000; // let the stored list arrive (and edits settle) before sending
const RETRY_MS = 10 * 60_000; // a send that didn't land (non-admin login) is retried this rarely

// Keeps HA's copy of the medicines (sensor.dashboard_medicines, a trigger-based
// template sensor fed by the `dashboard_medicines` event) up to date for its
// reminder and low-stock automations. Every open dashboard compares the
// sensor's state with the summary's hash and, when they differ, sends the
// summary; once one has landed the others match and stay quiet. Firing events
// needs an admin login; other logins just never send. Renders nothing.
export function MedicinesToHa() {
  const hass = useHass();
  const { status } = useHassStatus();
  const doc = useStoreDoc(MEDICINES.store, 'Medicines');
  const sensor = useEntity(HA_SENSOR);
  const now = useNow(60_000);
  const minute = Math.floor(now.getTime() / 60_000);
  const summary = useMemo(
    () => (doc === null ? null : haSummary(parseMedicines(doc), now, MED_TIMES, MEDICINES.people, MEDICINES.lowDays)),
    [doc, minute],
  );
  const tried = useRef<{ hash: string; at: number } | null>(null);
  const current = sensor?.state;

  useEffect(() => {
    if (!summary || status !== 'live' || current === summary.hash) return;
    const last = tried.current;
    if (last && last.hash === summary.hash && Date.now() - last.at < RETRY_MS) return;
    const t = window.setTimeout(() => {
      tried.current = { hash: summary.hash, at: Date.now() };
      hass.fireEvent(HA_EVENT, { ...summary }).catch(() => undefined);
    }, WAIT_MS);
    return () => window.clearTimeout(t);
  }, [summary, status, current, hass]);

  return null;
}
