import { useEffect, useMemo, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { RECOVERY, ROOMS } from '../config/entities';
import { useHass, type HassApi, type RegistryEntity, type RegistrySnapshot } from '../ha/api';
import { REGISTRY_REFRESH_MS as REFRESH_MS, loadRegistry } from '../ha/registry';
import { useAllEntities } from '../ha/store';

export type Recovery =
  | { kind: 'button'; entityId: string; label: string; available: boolean }
  | { kind: 'matter'; label: string }
  | { kind: 'reload'; label: string };

export interface OfflineDevice {
  id: string;
  name: string;
  area?: string;
  integration: string;
  platform: string;
  since?: string; // ISO time the device went unavailable
  recovery: Recovery;
  hint?: string;
}

// How to bring a device back, in order: its own restart/reboot/refresh button,
// a Matter Server restart, or a reload of its config entry.
function pickRecovery(ents: RegistryEntity[], platform: string, states: HassEntities) {
  const integration = RECOVERY.integrations[platform] ?? platform.replace(/_/g, ' ');
  const restart = ents.find((e) => e.entityId.startsWith('button.') && /_(restart|reboot|force_refresh)$/.test(e.entityId));

  let recovery: Recovery;
  let hint: string | undefined;
  if (restart && states[restart.entityId] && states[restart.entityId].state !== 'unavailable') {
    recovery = { kind: 'button', entityId: restart.entityId, label: restart.entityId.endsWith('force_refresh') ? 'Refresh' : 'Restart', available: true };
  } else if (platform === 'matter') {
    recovery = { kind: 'matter', label: 'Restart Matter Server' };
    hint = 'Briefly drops every Matter device while the server restarts.';
  } else {
    recovery = { kind: 'reload', label: `Reload ${integration}` };
    if (RECOVERY.accountWide.includes(platform)) hint = `Reloads every ${integration} device, not just this one.`;
  }
  if (RECOVERY.usuallyPoweredOff.includes(platform)) hint = 'Usually just switched off. Reloading only helps if it is on.';
  return { integration, platform, recovery, hint };
}

const areaName = (id: string | null) => {
  if (!id) return undefined;
  return ROOMS.find((r) => r.id === id)?.name ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// A device counts as offline when every one of its primary (non-config,
// non-diagnostic) entities is `unavailable`. `unknown` doesn't count:
// that's usually a sensor with no reading yet.
export function useOfflineDevices(): { devices: OfflineDevice[]; error?: string; refresh: () => void } {
  const hass = useHass();
  const states = useAllEntities();
  const [registry, setRegistry] = useState<RegistrySnapshot>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    loadRegistry(hass, nonce > 0)
      .then((r) => {
        if (!alive) return;
        setRegistry(r);
        setError(undefined);
      })
      .catch((e) => alive && setError(String(e?.message ?? e)));
    const id = window.setInterval(() => setNonce((n) => n + 1), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass, nonce]);

  const devices = useMemo(() => {
    if (!registry) return [];
    const byDevice = new Map<string, RegistrySnapshot['entities']>();
    for (const e of registry.entities) {
      const list = byDevice.get(e.deviceId) ?? [];
      list.push(e);
      byDevice.set(e.deviceId, list);
    }

    const out: OfflineDevice[] = [];
    for (const d of registry.devices) {
      if (d.disabled) continue;
      const ents = (byDevice.get(d.id) ?? []).filter((e) => states[e.entityId]);
      if (!ents.length) continue;
      const primary = ents.filter((e) => !e.category);
      const watch = primary.length ? primary : ents;
      if (!watch.every((e) => states[e.entityId].state === 'unavailable')) continue;

      const since = watch.map((e) => states[e.entityId].last_changed).sort().pop();
      out.push({ id: d.id, name: d.name, area: areaName(d.areaId), since, ...pickRecovery(ents, watch[0].platform, states) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [registry, states]);

  return { devices, error, refresh: () => setNonce((n) => n + 1) };
}

export function runRecovery(hass: HassApi, device: Pick<OfflineDevice, 'id' | 'recovery'>): Promise<unknown> {
  const r = device.recovery;
  if (r.kind === 'button') return hass.callService('button', 'press', {}, { entity_id: r.entityId });
  if (r.kind === 'matter') return hass.callService('hassio', 'addon_restart', { addon: RECOVERY.matterServerApp });
  return hass.callService('homeassistant', 'reload_config_entry', {}, { device_id: device.id });
}

// Recover the devices behind some entities (e.g. offline power plugs), using
// the same per-device choice as the status dialog. Each device is handled once,
// and the Matter Server is restarted at most once however many need it.
export async function recoverEntities(hass: HassApi, entityIds: string[], states: HassEntities): Promise<void> {
  const registry = await loadRegistry(hass);
  const byDevice = new Map<string, RegistryEntity>();
  for (const id of entityIds) {
    const entry = registry.entities.find((e) => e.entityId === id);
    if (entry && !byDevice.has(entry.deviceId)) byDevice.set(entry.deviceId, entry);
  }
  const jobs: { id: string; recovery: Recovery }[] = [];
  for (const [id, entry] of byDevice) {
    const ents = registry.entities.filter((e) => e.deviceId === id);
    const { recovery } = pickRecovery(ents, entry.platform, states);
    if (recovery.kind === 'matter' && jobs.some((j) => j.recovery.kind === 'matter')) continue;
    jobs.push({ id, recovery });
  }
  if (!jobs.length) throw new Error('No matching devices found');
  const results = await Promise.allSettled(jobs.map((j) => runRecovery(hass, j)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) throw new Error(`${failed.length} of ${jobs.length} failed: ${String((failed[0] as PromiseRejectedResult).reason?.message ?? (failed[0] as PromiseRejectedResult).reason)}`);
}
