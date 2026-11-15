import { useCallback, useMemo } from 'react';
import { NAMES_DASHBOARD } from '../config/load';
import { parseClientNames, type ClientName, type ClientNames } from '../lib/network';
import { useSaveStoreDoc, useStoreDoc } from '../storage';

// The names the owner gave the router's clients, shared by every screen: the
// config of the hidden NAMES_DASHBOARD in HA, kept through storage/ (followed
// live, a local copy so a reload shows them at once). `save` changes just that
// one client in the stored names, so two screens naming different devices don't
// undo each other. A non-admin login saves through the inbox list, if there is one.
export function useClientNames(): { names: ClientNames; save: (mac: string, entry: ClientName | null) => Promise<void> } {
  const doc = useStoreDoc(NAMES_DASHBOARD, 'ClientNamesDoc');
  const names = useMemo(() => parseClientNames(doc), [doc]);
  const update = useSaveStoreDoc(NAMES_DASHBOARD, 'ClientNamesDoc', 'Network client names');

  const save = useCallback(
    (mac: string, entry: ClientName | null) =>
      update((current) => {
        const next = { ...parseClientNames(current) };
        if (entry && (entry.device || entry.name?.trim())) next[mac] = entry;
        else delete next[mac];
        return { clients: next };
      }),
    [update],
  );

  return { names, save };
}
