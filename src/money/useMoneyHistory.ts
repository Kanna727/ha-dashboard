import { useEffect, useMemo, useState } from 'react';
import { FINANCE } from '../config/entities';
import { useHass } from '../ha/api';
import { readCache, writeCache } from '../ha/useRegistry';
import { parseMoneyHistory, type MoneyHistory } from '../lib/finance';

// The deployed preview shares the live dashboard's origin, so the mock keeps its own copy.
const CACHE_KEY = import.meta.env.VITE_MOCK ? 'mockMoneyHistory' : 'dashMoneyHistory';

// The money charts' data: the hidden FINANCE.store dashboard the sync writes
// once a day (lib/finance.ts, parseMoneyHistory), followed live, with a local
// copy so a reload draws the charts at once. Empty until the sync writes it.
export function useMoneyHistory(): MoneyHistory {
  const hass = useHass();
  const [doc, setDoc] = useState<unknown>(() => readCache(CACHE_KEY, null));

  useEffect(() => {
    let alive = true;
    const load = () =>
      hass
        .fetchStore(FINANCE.store)
        .then((d) => {
          if (!alive || d === null) return;
          setDoc(d);
          writeCache(CACHE_KEY, d);
        })
        .catch(() => undefined);
    load();
    const unsub = hass.subscribeStore(FINANCE.store, load);
    return () => {
      alive = false;
      unsub();
    };
  }, [hass]);

  return useMemo(() => parseMoneyHistory(doc), [doc]);
}
