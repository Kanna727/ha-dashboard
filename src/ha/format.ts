import type { HassEntity } from 'home-assistant-js-websocket';

export const isUnavailable = (e: HassEntity | undefined) =>
  !e || e.state === 'unavailable' || e.state === 'unknown';

export const isOn = (e: HassEntity | undefined) =>
  !!e && ['on', 'open', 'playing', 'home', 'unlocked', 'cool', 'heat', 'dry', 'fan_only', 'auto', 'heat_cool'].includes(e.state);

export function num(e: HassEntity | undefined): number | undefined {
  if (isUnavailable(e)) return undefined;
  const n = parseFloat(e!.state);
  return Number.isFinite(n) ? n : undefined;
}

export function fmtNum(e: HassEntity | undefined, digits = 0, fallback = '–'): string {
  const n = num(e);
  return n === undefined ? fallback : n.toFixed(digits);
}

export function fmtWatts(w: number | undefined): string {
  if (w === undefined) return '–';
  if (w >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}

export function domainOf(entityId: string) {
  return entityId.split('.')[0];
}

// Accepts an ISO string or epoch ms; '' for missing or unparseable values
// (e.g. the state of an unavailable timestamp sensor).
export function relTime(when: string | number | undefined): string {
  if (when === undefined || when === '') return '';
  const t = typeof when === 'number' ? when : new Date(when).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function stateLabel(e: HassEntity | undefined): string {
  if (!e) return 'Missing';
  if (e.state === 'unavailable') return 'Offline';
  if (e.state === 'unknown') return '–';
  const d = domainOf(e.entity_id);
  if (d === 'light' && e.state === 'on') {
    const b = e.attributes.brightness as number | undefined;
    return b ? `${Math.round((b / 255) * 100)}%` : 'On';
  }
  if (d === 'fan' && e.state === 'on') {
    const p = e.attributes.percentage as number | undefined;
    return p ? `${Math.round(p)}%` : 'On';
  }
  return e.state.charAt(0).toUpperCase() + e.state.slice(1).replace(/_/g, ' ');
}
