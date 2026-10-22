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

export interface HaNotice {
  title: string;
  text?: string;
  emoji?: string; // the first emoji in the notification, shown big instead of an icon
  tone: 'ok' | 'warn' | 'alarm';
}

// One emoji with its variation selector, skin tone and ZWJ joins (🧺, ♨️, 👩‍🍳).
const EMOJI = /\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*(?:\u200D\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)*/gu;
// Messages the companion app treats as commands, not as something to show.
const COMMAND = /^(clear_notification|remove_channel|request_location_update|update_sensors|command_\w+|TTS)$/i;
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
// of `alarms` (any case), else a warning by emoji or wording. Null for an
// empty message or a companion-app command.
export function noticeFrom(data: Record<string, unknown>, alarms: string[] = []): HaNotice | null {
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  const rawTitle = typeof data.title === 'string' ? data.title.trim() : '';
  if (!message && !rawTitle) return null;
  if (COMMAND.test(message)) return null;
  const emoji = (rawTitle + ' ' + message).match(EMOJI)?.[0];
  const title = clean(rawTitle) || clean(message);
  const text = rawTitle && clean(message) ? clean(message) : undefined;
  if (!title) return null;
  const asked = askedTone(data);
  if (asked) return { title, text, emoji, tone: asked };
  const all = `${rawTitle} ${message}`.toLowerCase();
  if (sentAsAlarm(data) || alarms.some((a) => a.trim() && all.includes(a.trim().toLowerCase()))) return { title, text, emoji, tone: 'alarm' };
  const warn = (emoji !== undefined && WARN_EMOJI.has(emoji)) || WARN_WORDS.test(all);
  return { title, text, emoji, tone: warn ? 'warn' : 'ok' };
}
