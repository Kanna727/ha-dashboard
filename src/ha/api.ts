import { createContext, useContext } from 'react';
import type { CameraState } from './cameraStream';

// connecting:   no connection yet (possibly showing the cached snapshot)
// live:         connected and the first live state dump has arrived
// reconnecting: connection dropped or initial connect failed; retrying
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export interface HassStatus {
  status: ConnectionStatus;
  userName?: string;
}

export interface HistoryPoint {
  t: number; // epoch ms
  v: number;
}

export interface ForecastDay {
  datetime: string;
  condition: string;
  temperature: number;
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
  // Optional extras some integrations add (Google Weather has them all).
  apparent_temperature?: number;
  humidity?: number;
  wind_speed?: number;
  wind_gust_speed?: number;
  wind_bearing?: number;
  uv_index?: number;
  cloud_coverage?: number;
  is_daytime?: boolean;
}

export interface TodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  due?: string | null; // 'YYYY-MM-DD' or an ISO date-time
  description?: string | null;
  completed?: string | null;
}

// One event from a calendar.* entity (calendar.get_events): start/end are
// 'YYYY-MM-DD' for all-day events (end exclusive), else ISO date-times.
export interface CalendarEventItem {
  calendar: string; // the calendar's entity ID
  summary: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
  uid?: string;
  recurrenceId?: string;
}

// A change to a calendar.* entity's events (calendar/event/create, update, delete;
// Local Calendar supports all three). `event` is HA's: summary, dtstart, dtend
// ('YYYY-MM-DD' for all day, else an ISO date-time), location, description.
export type CalendarChange =
  | { action: 'create'; event: Record<string, string> }
  | { action: 'update'; uid: string; recurrenceId?: string; event: Record<string, string> }
  | { action: 'delete'; uid: string; recurrenceId?: string };

export interface LovelaceCard {
  type: string;
  [key: string]: unknown;
}

export interface LovelaceConfig {
  views: { cards?: LovelaceCard[]; sections?: { cards?: LovelaceCard[] }[] }[];
}

export interface RegistryDevice {
  id: string;
  name: string;
  areaId: string | null;
  model?: string | null;
  disabled: boolean;
  macs?: string[]; // the device's MAC connections, as HA stores them (lower case, colons)
  identifiers?: string[]; // the values of the device's identifiers (an appliance ID, a cloud device ID, a serial…)
  serial?: string | null;
}

export interface RegistryEntity {
  entityId: string;
  deviceId: string;
  platform: string;
  category?: string; // 'config' | 'diagnostic'
  translationKey?: string;
  areaId?: string; // the entity's own area, when it isn't the device's
  hidden?: boolean; // hidden in HA
  name?: string; // the entity's own name; a device's main entity has none
}

export interface RegistrySnapshot {
  devices: RegistryDevice[];
  entities: RegistryEntity[];
}

// One long-term statistics bucket (recorder/statistics_during_period).
export interface StatPoint {
  start: number; // epoch ms
  mean?: number;
  max?: number; // only when asked for (`types` includes 'max')
}

// How much a total_increasing sensor grew in one statistics period.
export interface StatChange {
  start: number; // epoch ms, the period's start
  change: number;
}

export interface AutomationConfig {
  entityId: string;
  config: unknown;
}

export interface LastState {
  state: string;
  t: number;
}

export interface HassTarget {
  entity_id?: string | string[];
  area_id?: string | string[];
  device_id?: string | string[];
}

// Everything the UI needs from HA. Implemented by the live WebSocket
// provider and by the mock provider used for local preview.
// Kept referentially stable for the life of the page, so effects that depend
// on it don't re-run (and re-fetch) on every reconnect.
export interface HassApi {
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: HassTarget): Promise<unknown>;
  // Fires an event on HA's bus (admin users only), e.g. for a trigger-based template sensor.
  fireEvent(eventType: string, data: Record<string, unknown>): Promise<void>;
  fetchHistory(entityIds: string[], hours: number): Promise<Record<string, HistoryPoint[]>>;
  // Each entity's newest state in the window that isn't unavailable/unknown, with
  // its time in ms. For last-known values of non-numeric entities (e.g. binary sensors).
  fetchLastStates(entityIds: string[], hours: number): Promise<Record<string, LastState | undefined>>;
  // Long-term statistics (kept beyond the recorder's ~10 days), mean per period.
  fetchStatistics(ids: string[], days: number, period: 'hour' | 'day', types?: ('mean' | 'max')[]): Promise<Record<string, StatPoint[]>>;
  // Growth per period of total_increasing sensors (odometer, trips today, ...), from long-term statistics.
  fetchStatChanges(ids: string[], days: number, period: 'day' | 'week' | 'month'): Promise<Record<string, StatChange[]>>;
  subscribeForecast(entityId: string, type: 'daily' | 'hourly', cb: (days: ForecastDay[]) => void): () => void;
  fetchTodo(entityId: string): Promise<TodoItem[]>;
  // A to-do list's items, now and after every change (todo/item/subscribe).
  // Writes go through callService (todo.add_item, update_item, remove_item, ...).
  subscribeTodo(entityId: string, cb: (items: TodoItem[]) => void): () => void;
  // Events of calendar.* entities between two times (calendar.get_events).
  fetchCalendarEvents(entityIds: string[], start: Date, end: Date): Promise<CalendarEventItem[]>;
  // Adds, changes or deletes one (calendar/event/*).
  changeCalendarEvent(entityId: string, change: CalendarChange): Promise<void>;
  // Raw Lovelace config of a storage dashboard (authenticated WS call).
  fetchLovelaceConfig(urlPath: string): Promise<LovelaceConfig>;
  // Device + entity registry, used to group unavailable entities by device.
  fetchRegistry(): Promise<RegistrySnapshot>;
  // Every automation's raw config (automation/config), for the thresholds they gate on.
  fetchAutomationConfigs(): Promise<AutomationConfig[]>;
  // The arranged card layout every device shares (layout/Canvas.tsx), kept as the
  // config of a hidden dashboard: null if it was never saved. Saving needs an admin
  // user and creates the dashboard the first time.
  fetchLayout(): Promise<unknown | null>;
  saveLayout(layout: object): Promise<void>;
  // Calls back whenever any device saves the layout.
  subscribeLayout(cb: () => void): () => void;
  // A small JSON document kept as the config of another hidden storage
  // dashboard (`urlPath`), the same way as the layout: null if never saved;
  // saving needs an admin and creates the dashboard (titled `title`) the first time.
  fetchStore(urlPath: string): Promise<unknown | null>;
  saveStore(urlPath: string, data: object, title: string): Promise<void>;
  subscribeStore(urlPath: string, cb: () => void): () => void;
  // Every notify.* service call in HA (an automation messaging the phones), from
  // the call_service event, which only admin users may subscribe to. `ready`
  // says once whether the subscription was accepted.
  subscribeNotifyCalls(cb: (service: string, data: Record<string, unknown>) => void, ready: (ok: boolean) => void): () => void;
  // Plays a camera's live view in a muted <video> (WebRTC, else HLS) and reports
  // whether it's playing. Returns a function that stops it.
  playCamera(entityId: string, video: HTMLVideoElement, onState: (s: CameraState) => void): () => void;
  logout(): void;
}

export const HassContext = createContext<HassApi | null>(null);
export const HassStatusContext = createContext<HassStatus>({ status: 'connecting' });

export function useHassStatus(): HassStatus {
  return useContext(HassStatusContext);
}

export function useHass(): HassApi {
  const api = useContext(HassContext);
  if (!api) throw new Error('useHass outside HassContext');
  return api;
}
