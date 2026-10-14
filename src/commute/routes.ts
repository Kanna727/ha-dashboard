import { COMMUTE } from '../config/entities';
import type { LovelaceCard, LovelaceConfig } from '../ha/api';

export type TravelMode = 'DRIVE' | 'TWO_WHEELER';
export type Speed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CommuteConfig {
  title: string;
  apiKey: string;
  origin: LatLng;
  dest: LatLng;
  center: LatLng;
  height: number;
  compactHeight: number;
  defaultVehicle: TravelMode;
  alertThresholdMin: number;
}

export interface Route {
  seconds: number;
  meters: number;
  encodedPolyline: string;
  intervals: { start: number; end?: number; speed: Speed }[];
}

export const SPEED_COLORS: Record<Speed, string> = { NORMAL: '#4285F4', SLOW: '#FBBC04', TRAFFIC_JAM: '#EA4335' };
export const ALT_ROUTE_COLOR = '#9e9e9e';

export function inCommuteWindow(now = new Date()): boolean {
  const h = now.getHours();
  return COMMUTE.windowDays.includes(now.getDay()) && h >= COMMUTE.windowStartHour && h < COMMUTE.windowEndHour;
}

function px(v: unknown, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function findCard(cards: LovelaceCard[] | undefined, type: string): LovelaceCard | undefined {
  for (const c of cards ?? []) {
    if (c.type === type) return c;
    const nested = findCard(c.cards as LovelaceCard[] | undefined, type) ?? (c.card ? findCard([c.card as LovelaceCard], type) : undefined);
    if (nested) return nested;
  }
  return undefined;
}

// Pull the commute card out of the Lovelace dashboard config. Accepts the
// same keys as the custom:commute-traffic-map card.
export function extractCommuteConfig(lovelace: LovelaceConfig): CommuteConfig | null {
  let card: LovelaceCard | undefined;
  for (const view of lovelace.views ?? []) {
    card = findCard(view.cards, COMMUTE.cardType) ?? findCard(view.sections?.flatMap((s) => s.cards ?? []), COMMUTE.cardType);
    if (card) break;
  }
  if (!card || typeof card.api_key !== 'string') return null;
  const n = (k: string) => Number(card![k]);
  const origin = { lat: n('origin_lat'), lng: n('origin_lng') };
  const dest = { lat: n('dest_lat'), lng: n('dest_lng') };
  if (![origin.lat, origin.lng, dest.lat, dest.lng].every(Number.isFinite)) return null;
  return {
    title: (card.title as string) || 'Commute',
    apiKey: card.api_key,
    origin,
    dest,
    center: {
      lat: Number.isFinite(n('center_lat')) ? n('center_lat') : (origin.lat + dest.lat) / 2,
      lng: Number.isFinite(n('center_lng')) ? n('center_lng') : (origin.lng + dest.lng) / 2,
    },
    height: px(card.height, 320),
    compactHeight: px(card.compact_height, 200),
    defaultVehicle: card.default_vehicle === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE',
    alertThresholdMin: Number(card.alert_threshold_minutes) || 20,
  };
}

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function parseSeconds(d: string | undefined): number {
  return d ? parseInt(d.replace('s', ''), 10) : Infinity;
}

interface RoutesRequest {
  apiKey: string;
  origin: LatLng;
  dest: LatLng;
  mode: TravelMode;
  alternatives: boolean;
  departureOffsetMin?: number;
  signal?: AbortSignal;
}

// Google Routes API v2, traffic-aware, with per-segment speed readings.
export async function computeRoutes(req: RoutesRequest): Promise<Route[]> {
  const detailed = req.departureOffsetMin === undefined;
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: req.origin.lat, longitude: req.origin.lng } } },
    destination: { location: { latLng: { latitude: req.dest.lat, longitude: req.dest.lng } } },
    travelMode: req.mode,
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    computeAlternativeRoutes: req.alternatives,
    languageCode: 'en-US',
    units: 'METRIC',
  };
  if (detailed) body.extraComputations = ['TRAFFIC_ON_POLYLINE'];
  else body.departureTime = new Date(Date.now() + req.departureOffsetMin! * 60_000).toISOString();

  const resp = await fetch(ROUTES_URL, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': req.apiKey,
      'X-Goog-FieldMask': detailed
        ? 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals'
        : 'routes.duration',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok || !data.routes?.length) {
    // computeRoutes returns a bare 403 for several causes; in practice it has
    // been billing being off on the key's Cloud project.
    if (data.error?.status === 'PERMISSION_DENIED') {
      throw new Error('Google refused the request. Check billing is enabled on the API key\'s Cloud project, and that Routes API is enabled and allowed for the key.');
    }
    throw new Error(data.error?.message ?? `Routes API ${resp.status}`);
  }
  return data.routes.map(
    (r: {
      duration?: string;
      distanceMeters?: number;
      polyline?: { encodedPolyline?: string };
      travelAdvisory?: { speedReadingIntervals?: { startPolylinePointIndex?: number; endPolylinePointIndex?: number; speed?: Speed }[] };
    }) => ({
      seconds: parseSeconds(r.duration),
      meters: r.distanceMeters ?? 0,
      encodedPolyline: r.polyline?.encodedPolyline ?? '',
      intervals: (r.travelAdvisory?.speedReadingIntervals ?? []).map((i) => ({
        start: i.startPolylinePointIndex ?? 0,
        end: i.endPolylinePointIndex,
        speed: i.speed ?? 'NORMAL',
      })),
    }),
  );
}

export const fmtMin = (seconds: number) => `${Math.round(seconds / 60)} min`;
