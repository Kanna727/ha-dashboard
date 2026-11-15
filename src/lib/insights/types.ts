// What the house insights engine works with and returns. Nothing here talks to
// Home Assistant: the hook (panels/useInsights.ts) fetches the history and the
// automations and hands them in, so every detector is a pure function and
// unit-tested. No cloud model: the "learning" is medians, spreads and
// clustering over the last days of Home Assistant's own history.

// One state change of an entity (history/history_during_period, minimal).
export interface StateRow {
  t: number; // epoch ms
  s: string;
}

export type Severity = 'info' | 'notice' | 'alert';

export type InsightKind = 'energy-high' | 'energy-low' | 'left-on' | 'habit' | 'door-odd-hour' | 'door-open-long';

// A Home Assistant automation, as the config API takes it (2024.10+ syntax).
export interface AutomationDraft {
  alias: string;
  description: string;
  mode: 'single' | 'restart';
  triggers: Record<string, unknown>[];
  conditions: Record<string, unknown>[];
  actions: Record<string, unknown>[];
}

export interface Suggestion {
  // Stable for the same suggestion, so a dismissed one stays dismissed.
  id: string;
  title: string;
  why: string;
  draft: AutomationDraft;
  // The alias of an existing automation that already seems to do this.
  covered?: string;
}

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  entity: string;
  name: string;
  title: string;
  detail: string;
  // When it happened (or began), epoch ms.
  at: number;
  // How sure it is, 0..1 (a habit: the share of days it happened); orders findings of the same kind.
  score?: number;
  suggestion?: Suggestion;
}

// A device whose on/off history is read.
export interface Device {
  entity: string;
  name: string;
  // geyser: a water heater switch (runs for a while, then should go off).
  kind: 'light' | 'fan' | 'switch' | 'climate' | 'geyser';
}

export interface DayKwh {
  start: number; // local midnight, epoch ms
  kwh: number;
}

export interface Automation {
  entityId: string;
  config: unknown;
}

export interface InsightsInput {
  now: number;
  devices: Device[];
  doors: { entity: string; name: string }[];
  history: Record<string, StateRow[]>;
  // Complete days only, oldest first.
  energy: { entity: string; name: string; days: DayKwh[] }[];
  automations: Automation[];
}
