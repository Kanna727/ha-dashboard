import { useCallback, useEffect, useState } from 'react';
import { NAMES_DASHBOARD } from '../config/load';
import { useHass } from '../ha/api';
import { readCache, writeCache } from '../ha/useRegistry';
import { parseClientNames, type ClientName, type ClientNames } from '../lib/network';

// The deployed preview shares the live dashboard's origin, so the mock keeps its own copy.
const CACHE_KEY = import.meta.env.VITE_MOCK ? 'mockClientNames' : 'dashClientNames';

// The names the owner gave the router's clients, shared by every screen: the
// config of the hidden NAMES_DASHBOARD in HA (like the card layout), followed
// live, with a local copy so a reload shows them at once. `save` re-reads the
// stored names first, so two screens naming different devices don't undo
// each other; it needs an admin login.
export function useClientNames(): { names: ClientNames; save: (mac: string, entry: ClientName | null) => Promise<void> } {
  const hass = useHass();
  const [names, setNames] = useState<ClientNames>(() => readCache(CACHE_KEY, {}));

  useEffect(() => {
    let alive = true;
    const load = () =>
      hass
        .fetchStore(NAMES_DASHBOARD)
        .then((doc) => {
          if (!alive) return;
          const next = parseClientNames(doc);
          setNames(next);
          writeCache(CACHE_KEY, next);
        })
        .catch(() => undefined);
    load();
    const unsub = hass.subscribeStore(NAMES_DASHBOARD, load);
    return () => {
      alive = false;
      unsub();
    };
  }, [hass]);

  const save = useCallback(
    async (mac: string, entry: ClientName | null) => {
      const current = parseClientNames(await hass.fetchStore(NAMES_DASHBOARD));
      const next = { ...current };
      if (entry && (entry.device || entry.name?.trim())) next[mac] = entry;
      else delete next[mac];
      await hass.saveStore(NAMES_DASHBOARD, { clients: next }, 'Network client names');
      setNames(next);
      writeCache(CACHE_KEY, next);
    },
    [hass],
  );

  return { names, save };
}
