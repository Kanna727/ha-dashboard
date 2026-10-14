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
}

export interface RegistrySnapshot {
  devices: RegistryDevice[];
  entities: RegistryEntity[];
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
  subscribeForecast(entityId: string, type: 'daily' | 'hourly', cb: (days: ForecastDay[]) => void): () => void;
  fetchTodo(entityId: string): Promise<TodoItem[]>;
  // Raw Lovelace config of a storage dashboard (authenticated WS call).
  fetchLovelaceConfig(urlPath: string): Promise<LovelaceConfig>;
  // Device + entity registry, used to group unavailable entities by device.
  fetchRegistry(): Promise<RegistrySnapshot>;
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
