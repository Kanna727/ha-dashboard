// Decisions behind the "done", "door left open" and mirrored Home Assistant
// alerts. Pure, unit-tested.

// A cycle ended when we saw it running and now it isn't. Unknown (first
// reading after load) never counts, so a reload doesn't announce old news.
export const cycleEnded = (wasRunning: boolean | undefined, running: boolean) => wasRunning === true && !running;

export interface DoorReading {
  id: string;
  open: boolean;
  since: number; // epoch ms of the last state change
}

// Doors open for at least `minutes`, as keys `${id}@${since}`, so each open
// episode alerts once (closing and reopening is a new episode).
export function overdueDoors(doors: DoorReading[], now: number, minutes: number, alerted: Set<string>): { id: string; key: string; openMin: number }[] {
  return doors
    .filter((d) => d.open && Number.isFinite(d.since) && now - d.since >= minutes * 60_000)
    .map((d) => ({ id: d.id, key: `${d.id}@${d.since}`, openMin: Math.floor((now - d.since) / 60_000) }))
    .filter((d) => !alerted.has(d.key));
}

// Whether a notify service (the part after "notify.") is one to mirror.
// Patterns are service names; a trailing * matches a prefix ("mobile_app_*").
export const mirrorsService = (service: string, patterns: string[]) =>
  patterns.some((p) => (p.endsWith('*') ? service.startsWith(p.slice(0, -1)) : service === p));

// An alert that takes itself down once what it is about is resolved: any of
// `entities` reaching one of `states` (the door it's about closes).
export interface DismissWhen {
  entities: string[];
  states: string[];
}

export interface HaNotice {
  title: string;
  text?: string;
  emoji?: string; // the first emoji in the notification, shown big instead of an icon
  tone: 'ok' | 'warn' | 'alarm';
  dismissWhen?: DismissWhen;
}

// A change this long before the alert arrived still counts: the door can
// close while HA is still sending the notification.
const RESOLVE_GRACE_MS = 5_000;

// Whether an alert shown since `since` (epoch ms) is resolved: one of its
// entities is in a resolving state, reached after the alert came in (less the
// grace). One already resolved long before doesn't count, so a late alert,
// e.g. sent minutes after the door opened, is still shown.
export function isResolved(dw: DismissWhen, states: Record<string, { state: string; last_changed: string } | undefined>, since: number): boolean {
  return dw.entities.some((id) => {
    const s = states[id];
    return !!s && dw.states.includes(s.state) && Date.parse(s.last_changed) >= since - RESOLVE_GRACE_MS;
  });
}

// HA's own Live Updates (`data: { live_update: true }`, a pinned card on the
// phones that an automation re-sends as it moves: the dishwasher every 5 %,
// the vacuum every 2 min) alert here only at their start and their end, not
// at every refresh. Start: progress 0, or the first update of that Live Update
// (keyed by its `tag`, else its title) when it has no progress bar or it began
// part way. End: progress at progress_max (default 100). Each stage shows
// once; `clear_notification` for the tag forgets it, and a start after an end
// (a new cycle that never got cleared) shows again.
export type LiveStage = 'start' | 'end';
export interface LiveSeen {
  stage: LiveStage;
  at: number; // epoch ms, so a stale one can be dropped
}

const isLive = (v: unknown) => v === true || v === 'true';
const progressOf = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Whether a notify call should be mirrored, as far as Live Updates go (true for
// anything that isn't one). Records what it lets through in `seen`.
export function liveUpdateShows(data: Record<string, unknown>, seen: Map<string, LiveSeen>, now = Date.now()): boolean {
  const d = (data.data && typeof data.data === 'object' ? data.data : {}) as Record<string, unknown>;
  const tag = typeof d.tag === 'string' && d.tag ? d.tag : undefined;
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (message === 'clear_notification') {
    if (tag) seen.delete(tag);
    return true; // a command: noticeFrom drops it
  }
  if (!isLive(d.live_update)) return true;
  const key = tag ?? `title:${typeof data.title === 'string' ? data.title.trim() : message}`;
  const last = seen.get(key);
  const p = progressOf(d.progress);
  const max = progressOf(d.progress_max) || 100;
  const stage: LiveStage | undefined =
    p !== undefined && p >= max ? 'end' : (p !== undefined && p <= 0) || !last || last.stage === 'end' ? 'start' : undefined;
  if (!stage || last?.stage === stage) return false;
  seen.set(key, { stage, at: now });
  return true;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && x !== '');

// `data: { dashboard_dismiss: { entity_id, state } }` in the notify call (each
// a string or a list), shaped like a state condition.
function dismissFrom(data: Record<string, unknown>): DismissWhen | undefined {
  const d = (data.data as { dashboard_dismiss?: { entity_id?: unknown; state?: unknown } } | undefined)?.dashboard_dismiss;
  if (!d || typeof d !== 'object') return undefined;
  const entities = strings(d.entity_id);
  const states = strings(d.state);
  return entities.length && states.length ? { entities, states } : undefined;
}

// One emoji with its variation selector, skin tone and ZWJ joins (🧺, ♨️, 👩‍🍳).
const EMOJI = /\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*(?:\u200D\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)*/gu;
// Messages the companion app treats as commands, not as something to show.
// kiosk_*: the iOS app's kiosk mode (screensaver, brightness), sent to the wall tablet itself.
const COMMAND = /^(clear_notification|remove_channel|request_location_update|update_sensors|command_\w+|kiosk_\w+|TTS)$/i;
const WARN_EMOJI = new Set(['⚠️', '⚠', '🚨', '❗', '‼️', '🔥', '🛑']);
const WARN_WORDS = /\b(left open|unlocked|leak|alarm|warning|alert|failed|error)\b/i;

const clean = (s: string) => s.replace(EMOJI, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:·]+|[\s\-–—:·]+$/g, '');

// The companion apps' own alarm flags in the call's `data`: Android's alarm
// channel (rings even on silent) and iOS critical alerts.
function sentAsAlarm(data: Record<string, unknown>): boolean {
  const d = data.data;
  if (!d || typeof d !== 'object') return false;
  const { channel, push } = d as { channel?: unknown; push?: { 'interruption-level'?: unknown; sound?: { critical?: unknown } } };
  return channel === 'alarm_stream' || channel === 'alarm_stream_max' || push?.['interruption-level'] === 'critical' || Number(push?.sound?.critical) === 1;
}

// The tone an automation asks for here: `data: { dashboard: ok | warn | alarm }`.
// The companion apps ignore keys they don't know.
const TONES = new Set<HaNotice['tone']>(['ok', 'warn', 'alarm']);
function askedTone(data: Record<string, unknown>): HaNotice['tone'] | undefined {
  const t = (data.data as { dashboard?: unknown } | undefined)?.dashboard;
  return typeof t === 'string' && TONES.has(t as HaNotice['tone']) ? (t as HaNotice['tone']) : undefined;
}

// What a notify call's data shows as: its title (or the message when there is
// none), the message under it, and the first emoji lifted out as the picture.
// The tone: the one the automation asked for (data.dashboard), else an alarm
// when it was sent as one to the phones or its title or message contains one
// of `alarms` (any case), else a warning by emoji or wording. `dismissWhen`
// from data.dashboard_dismiss. Null for an empty message or a companion-app command.
export function noticeFrom(data: Record<string, unknown>, alarms: string[] = []): HaNotice | null {
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  const rawTitle = typeof data.title === 'string' ? data.title.trim() : '';
  if (!message && !rawTitle) return null;
  if (COMMAND.test(message)) return null;
  const emoji = (rawTitle + ' ' + message).match(EMOJI)?.[0];
  const title = clean(rawTitle) || clean(message);
  const text = rawTitle && clean(message) ? clean(message) : undefined;
  if (!title) return null;
  const all = `${rawTitle} ${message}`.toLowerCase();
  const tone =
    askedTone(data) ??
    (sentAsAlarm(data) || alarms.some((a) => a.trim() && all.includes(a.trim().toLowerCase()))
      ? 'alarm'
      : (emoji !== undefined && WARN_EMOJI.has(emoji)) || WARN_WORDS.test(all)
        ? 'warn'
        : 'ok');
  const dismissWhen = dismissFrom(data);
  return dismissWhen ? { title, text, emoji, tone, dismissWhen } : { title, text, emoji, tone };
}
