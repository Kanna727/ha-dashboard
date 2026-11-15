// "Start from my Home Assistant": fills the draft from the areas and entities HA has.
import { useState } from 'react';
import type { DashboardConfig } from '../config/types';
import { useHass } from '../ha/api';
import { useAllEntities } from '../ha/store';
import { starterConfig } from './starter';

export function StarterButton({ onPick }: { onPick: (c: DashboardConfig) => void }) {
  const hass = useHass();
  const states = useAllEntities();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  return (
    <span className="sf-starter">
      <button
        type="button"
        className="sf-btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const c = starterConfig(states, await hass.fetchRegistry().catch(() => undefined));
            onPick(c);
            setNote(`Started from ${c.ROOMS.length} room${c.ROOMS.length === 1 ? '' : 's'} found in Home Assistant. Check the Checks tab for what is left to pick.`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Looking…' : 'Start from my Home Assistant'}
      </button>
      {note && <span className="sf-help">{note}</span>}
    </span>
  );
}
