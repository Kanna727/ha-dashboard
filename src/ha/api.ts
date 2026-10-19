import { createContext, useContext } from 'react';

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
}

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
}

export interface RegistryEntity {
  entityId: string;
  deviceId: string;
  platform: string;
  category?: string; // 'config' | 'diagnostic'
  translationKey?: string;
}

export interface RegistrySnapshot {
  devices: RegistryDevice[];
  entities: RegistryEntity[];
}

// One long-term statistics bucket (recorder/statistics_during_period).
export interface StatPoint {
  start: number; // epoch ms
  mean?: number;
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
  fetchHistory(entityIds: string[], hours: number): Promise<Record<string, HistoryPoint[]>>;
  // Each entity's newest state in the window that isn't unavailable/unknown, with
  // its time in ms. For last-known values of non-numeric entities (e.g. binary sensors).
  fetchLastStates(entityIds: string[], hours: number): Promise<Record<string, LastState | undefined>>;
  // Long-term statistics (kept beyond the recorder's ~10 days), mean per period.
  fetchStatistics(ids: string[], days: number, period: 'hour' | 'day'): Promise<Record<string, StatPoint[]>>;
  subscribeForecast(entityId: string, type: 'daily' | 'hourly', cb: (days: ForecastDay[]) => void): () => void;
  fetchTodo(entityId: string): Promise<TodoItem[]>;
  // Raw Lovelace config of a storage dashboard (authenticated WS call).
  fetchLovelaceConfig(urlPath: string): Promise<LovelaceConfig>;
  // Device + entity registry, used to group unavailable entities by device.
  fetchRegistry(): Promise<RegistrySnapshot>;
  // Every automation's raw config (automation/config), for the thresholds they gate on.
  fetchAutomationConfigs(): Promise<AutomationConfig[]>;
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
