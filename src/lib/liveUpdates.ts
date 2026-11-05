// Live Updates that other apps post on an Android phone (a food delivery being
// tracked, a ride on its way), read from the companion app's "Last notification"
// sensors. Pure, unit-tested; components/LiveUpdates.tsx shows them.
//
// That sensor holds one notification, so the list is built up from its changes.
// Apps can end a tracking update by replacing it with an ordinary notification
// (no removal is reported then), so a newer ordinary notification from the same
// app ends its card.

export interface NotificationState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface LiveUpdate {
  key: string; // one card per phone and app
  app: string;
  title: string;
  text?: string;
  percent?: number;
  at: number; // when the phone posted it (ms)
  logo?: string;
  color: string; // behind the logo, or behind the first letter when there's none
  delivery: boolean; // draw a rider going home on the progress line
}

export interface Reading {
  key: string;
  at: number;
  live?: LiveUpdate;
}

// A card whose app has gone quiet this long is dropped, for when the phone is
// off or out of reach and the end never arrives.
export const LIVE_MAX_MS = 90 * 60_000;

// The companion app sends unset fields as the text "null".
const text = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s !== 'null' ? s : undefined;
};
const yes = (v: unknown) => v === true || (typeof v === 'string' && v.toLowerCase() === 'true');

// The sensor only says "Icon(typ=BITMAP ...)", never the picture, so logos come
// from the web by the app's site. Apps not listed show their first letter.
const APPS: Record<string, { name: string; site: string; color: string }> = {
  'com.application.zomato': { name: 'Zomato', site: 'zomato.com', color: '#e23744' },
  'in.swiggy.android': { name: 'Swiggy', site: 'swiggy.com', color: '#fc8019' },
};
const logoOf = (site: string) => `https://www.google.com/s2/favicons?domain=${site}&sz=128`;
const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#a855f7', '#ec4899', '#f59e0b'];

const NOT_A_NAME = new Set(['android', 'app', 'apps', 'application', 'co', 'com', 'consumer', 'customer', 'in', 'main', 'mobile', 'net', 'org']);

// A readable name from the package: the last part that isn't boilerplate.
export function appName(pkg: string): string {
  if (APPS[pkg]) return APPS[pkg].name;
  const name = pkg.split('.').filter((p) => p && !NOT_A_NAME.has(p.toLowerCase())).pop() ?? pkg;
  return name[0].toUpperCase() + name.slice(1);
}

// The same colour for an app every time.
export function appLook(pkg: string): Pick<LiveUpdate, 'logo' | 'color' | 'delivery'> {
  const known = APPS[pkg];
  if (known) return { logo: logoOf(known.site), color: known.color, delivery: true };
  const sum = [...pkg].reduce((n, c) => n + c.charCodeAt(0), 0);
  return { color: COLORS[sum % COLORS.length], delivery: false };
}

function percentOf(a: Record<string, unknown>): number | undefined {
  const value = Number(a['android.progress']);
  const max = Number(a['android.progressMax']);
  if (yes(a['android.progressIndeterminate']) || !(max > 0) || !Number.isFinite(value)) return undefined;
  return Math.round((Math.min(Math.max(value, 0), max) / max) * 100);
}

// What one sensor reading says. Null when there's nothing to go on: no app, or
// no words at all (a group summary, whose state is just the package name), which
// mustn't end a card.
export function readNotification(s: NotificationState): Reading | null {
  const a = s.attributes;
  const pkg = text(a.package);
  const title = text(a['android.title']);
  const body = text(a['android.text']) ?? text(a['android.bigText']);
  const at = Number(a.post_time);
  if (!pkg || !(title || body) || !Number.isFinite(at)) return null;
  const phone = s.entity_id.replace(/_last(_removed)?_notification$/, '');
  const key = `${phone}|${pkg}`;
  // An app has to ask for promotion to post a Live Update; ordinary notifications don't.
  if (!yes(a['android.requestPromotedOngoing']) || !yes(a.is_ongoing)) return { key, at };
  const live = { key, app: appName(pkg), title: title ?? body!, text: title ? body : undefined, percent: percentOf(a), at, ...appLook(pkg) };
  return { key, at, live };
}

// The list after a notification was posted: its card added or updated, or gone
// when the app has moved on to an ordinary notification. Older news is ignored,
// so applying the same reading again changes nothing.
export function posted(list: LiveUpdate[], r: Reading | null): LiveUpdate[] {
  if (!r) return list;
  const cur = list.find((u) => u.key === r.key);
  if (cur && r.at < cur.at) return list;
  if (!r.live) return cur ? list.filter((u) => u !== cur) : list;
  return cur ? list.map((u) => (u === cur ? r.live! : u)) : [...list, r.live];
}

// The list after a notification was removed from the phone. Only the Live Update
// itself counts: an app clearing some other notification says nothing about it.
export function removed(list: LiveUpdate[], r: Reading | null): LiveUpdate[] {
  const gone = r?.live ? list.find((u) => u.key === r.key && r.at >= u.at) : undefined;
  return gone ? list.filter((u) => u !== gone) : list;
}

export const freshUpdates = (list: LiveUpdate[], now: number) => list.filter((u) => now - u.at < LIVE_MAX_MS);
