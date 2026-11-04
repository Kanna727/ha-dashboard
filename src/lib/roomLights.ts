import type { RegistryDevice, RegistrySnapshot } from '../ha/api';
import type { ControlDef, RoomDef } from '../config/types';

// Lights found per room id. Only lights the config doesn't list.
export type RoomLights = Record<string, ControlDef[]>;

const isLight = (id: string) => id.startsWith('light.');

// A bulb is a device whose light is the device itself: HA gives that entity no
// name of its own. A light with its own name is a part of something else, like
// a fan's LED ring or a Zwift rider's power zone colour.
const isBulb = (name: string | undefined, device: RegistryDevice) => !name || name.toLowerCase() === device.name.toLowerCase();

// A short label from the device's name: the room card already says which room
// it is, so "Bedroom Light 3" is "Light 3" and "Common Area Light" "Common Area".
export function lightLabel(device: string, room: RoomDef): string {
  const lower = device.toLowerCase();
  const prefix = [room.name, (room.area ?? room.id).replace(/_/g, ' ')].find((p) => lower.startsWith(`${p.toLowerCase()} `));
  const rest = prefix ? device.slice(prefix.length + 1).trim() : device;
  return rest.replace(/\s+lights?$/i, '').trim() || rest;
}

// Every bulb in a room's HA area that the room doesn't list already. Hiding a
// light in HA keeps it off the dashboard.
export function findRoomLights(rooms: RoomDef[], registry: RegistrySnapshot): RoomLights {
  const listed = new Set(rooms.flatMap((r) => r.controls.map((c) => c.entity)));
  const devices = new Map(registry.devices.map((d) => [d.id, d]));
  const byArea = new Map(rooms.map((r) => [r.area ?? r.id, r]));
  const found: RoomLights = {};
  for (const e of registry.entities) {
    if (!isLight(e.entityId) || listed.has(e.entityId) || e.hidden || e.category) continue;
    const device = devices.get(e.deviceId);
    if (!device || device.disabled || !isBulb(e.name, device)) continue;
    const room = byArea.get(e.areaId ?? device.areaId ?? '');
    if (room) (found[room.id] ??= []).push({ entity: e.entityId, name: lightLabel(device.name, room) });
  }
  for (const lights of Object.values(found)) lights.sort((a, b) => a.entity.localeCompare(b.entity));
  return found;
}

// The rooms with their found lights added after the lights they list.
export function withRoomLights(rooms: RoomDef[], found: RoomLights): RoomDef[] {
  return rooms.map((r) => {
    const extra = found[r.id];
    if (!extra?.length) return r;
    const at = r.controls.reduce((end, c, i) => (isLight(c.entity) ? i + 1 : end), 0);
    return { ...r, controls: [...r.controls.slice(0, at), ...extra, ...r.controls.slice(at)] };
  });
}
