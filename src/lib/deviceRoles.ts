import type { RegistryEntity } from '../ha/api';

// An integration names a device's entities `<domain>.<prefix>_<key>`, with the
// prefix from the device name ("sensor.office_scale_body_fat"). Given the keys
// a kind of device is known to have, find the prefix most of its entities
// agree on and map each known key to its entity. Voting on the prefix keeps a
// short key from claiming a longer, unknown one ("level" vs "run_level").
// Sensors win over other domains when two share a key.
export function deviceRoles(ids: string[], keys: readonly string[]): Record<string, string> {
  const known = new Set(keys);
  const objectId = (id: string) => id.slice(id.indexOf('.') + 1);
  const votes = new Map<string, number>();
  for (const id of ids) {
    const o = objectId(id);
    for (const k of keys) {
      if (o.endsWith(`_${k}`)) {
        const p = o.slice(0, -k.length - 1);
        votes.set(p, (votes.get(p) ?? 0) + 1);
      }
    }
  }
  const prefix = [...votes].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0];
  if (prefix === undefined) return {};
  const out: Record<string, string> = {};
  const ordered = [...ids].sort((a, b) => Number(!a.startsWith('sensor.')) - Number(!b.startsWith('sensor.')));
  for (const id of ordered) {
    const o = objectId(id);
    if (!o.startsWith(`${prefix}_`)) continue;
    const k = o.slice(prefix.length + 1);
    if (known.has(k) && !(k in out)) out[k] = id;
  }
  return out;
}

// Entity IDs per device, from the registry.
export function idsByDevice(entities: RegistryEntity[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of entities) {
    const list = m.get(e.deviceId);
    if (list) list.push(e.entityId);
    else m.set(e.deviceId, [e.entityId]);
  }
  return m;
}
