import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMUTE } from '../config/entities';
import { useHass } from '../ha/api';
import { useNow } from '../hooks/useNow';
import { Icon } from '../components/Icon';
import { loadGoogleMaps } from './googleMaps';
import {
  ALT_ROUTE_COLOR,
  computeRoutes,
  extractCommuteConfig,
  fmtMin,
  inCommuteWindow,
  SPEED_COLORS,
  type CommuteConfig,
  type LatLng,
  type Route,
  type TravelMode,
} from './routes';

const REFRESH_MS = 2 * 60_000;
const OVERRIDE_TIMEOUT_MS = 5 * 60_000;
const STALE_MS = 5 * 60_000;
const LEAVE_LATER_MIN = [15, 30, 45];
const MAX_RECENTS = 5;

interface Place {
  latLng: LatLng;
  label: string;
  full: string;
}

function shortPlaceLabel(name: string | undefined, address: string | undefined): string {
  const n = name?.trim();
  const a = address ?? '';
  if (n && n !== a.trim() && !a.startsWith(n + ',')) return n;
  return a.split(',')[0].trim() || n || a || 'destination';
}

const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Commute settings live on the Lovelace card; undefined = loading, null = not found.
export function useCommuteConfig(): { config: CommuteConfig | null | undefined; error?: string } {
  const hass = useHass();
  const [config, setConfig] = useState<CommuteConfig | null>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    hass
      .fetchLovelaceConfig(COMMUTE.dashboard)
      .then((lovelace) => alive && setConfig(extractCommuteConfig(lovelace)))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [hass]);
  return { config, error };
}

export function commuteMissingText(config: CommuteConfig | null | undefined, error?: string) {
  if (error) return `Couldn't read the commute card: ${error}`;
  if (config === null) return `No ${COMMUTE.cardType} card with an API key found on the "${COMMUTE.dashboard}" dashboard.`;
  return 'Loading…';
}

export function CommuteCard({ mapHeight }: { mapHeight?: number }) {
  const { config, error } = useCommuteConfig();
  if (config) return <CommuteMap config={config} mapHeight={mapHeight} />;
  return (
    <section className="card commute">
      <header className="card-head"><Icon name="car" size={18} /><h2>Commute</h2></header>
      <p className="muted small">{commuteMissingText(config, error)}</p>
    </section>
  );
}

export function CommuteMap({ config, mapHeight }: { config: CommuteConfig; mapHeight?: number }) {
  const now = useNow(15_000);

  const mapDiv = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlays = useRef<(google.maps.Polyline | google.maps.Marker)[]>([]);
  const bounds = useRef<google.maps.LatLngBounds | null>(null);
  const autocompleteBound = useRef(false);

  const [mapReady, setMapReady] = useState(0);
  const [mode, setMode] = useState<TravelMode>(config.defaultVehicle);
  const [swapped, setSwapped] = useState(false);
  const [compact, setCompact] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [override, setOverride] = useState<Place | null>(null);
  const [recents, setRecents] = useState<Place[]>([]);
  const [result, setResult] = useState<{ routes: Route[]; origin: LatLng; dest: LatLng } | null>(null);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState('Loading map…');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [leaveLater, setLeaveLater] = useState<{ label: string; seconds: number }[] | null>(null);
  const [hoverTip, setHoverTip] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const choosePlace = useCallback((p: Place) => {
    setOverride(p);
    setRecents((prev) => [p, ...prev.filter((r) => r.label !== p.label)].slice(0, MAX_RECENTS));
  }, []);

  // Map + traffic layer, in the dashboard's dark scheme.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(config.apiKey)
      .then(() => {
        if (cancelled || !mapDiv.current) return;
        const map = new google.maps.Map(mapDiv.current, {
          zoom: 12,
          center: config.center,
          colorScheme: google.maps.ColorScheme.DARK,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
        });
        new google.maps.TrafficLayer().setMap(map);
        mapRef.current = map;

        if (inputRef.current && !autocompleteBound.current) {
          autocompleteBound.current = true;
          const ac = new google.maps.places.Autocomplete(inputRef.current, { fields: ['geometry', 'formatted_address', 'name'] });
          ac.bindTo('bounds', map);
          ac.addListener('place_changed', () => {
            const place = ac.getPlace();
            const loc = place.geometry?.location;
            if (!loc) return;
            choosePlace({
              latLng: { lat: loc.lat(), lng: loc.lng() },
              label: shortPlaceLabel(place.name, place.formatted_address),
              full: place.formatted_address || place.name || '',
            });
          });
        }
        setMapReady((n) => n + 1);
      })
      .catch((e) => setStatus(`Error loading Google Maps: ${e.message}`));
    return () => {
      cancelled = true;
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      mapRef.current = null;
    };
  }, [config, choosePlace]);

  // Fetch routes whenever the trip changes, on manual refresh, or on the timer.
  useEffect(() => {
    if (!mapReady) return;
    const ctrl = new AbortController();
    const home = config.origin;
    const away = override?.latLng ?? config.dest;
    const origin = swapped ? away : home;
    const dest = swapped ? home : away;
    setStatus('Updating…');
    setLeaveLater(null);

    computeRoutes({ apiKey: config.apiKey, origin, dest, mode, alternatives: true, signal: ctrl.signal })
      .then(async (routes) => {
        const best = routes.reduce((bi, r, i) => (r.seconds < routes[bi].seconds ? i : bi), 0);
        setResult({ routes, origin, dest });
        setSelected(best);
        setStatus('');
        setLastUpdate(Date.now());

        if (!override && inCommuteWindow()) {
          const later = await Promise.all(
            LEAVE_LATER_MIN.map((m) =>
              computeRoutes({ apiKey: config.apiKey, origin, dest, mode, alternatives: false, departureOffsetMin: m, signal: ctrl.signal })
                .then((r) => ({ label: `+${m}min`, seconds: r[0].seconds }))
                .catch(() => null),
            ),
          );
          if (!ctrl.signal.aborted) {
            setLeaveLater([{ label: 'Now', seconds: routes[best].seconds }, ...later.filter((x): x is { label: string; seconds: number } => !!x)]);
          }
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setStatus(`Routes API error: ${e.message}`);
      });
    return () => ctrl.abort();
  }, [mapReady, config, mode, swapped, override, tick]);

  // Auto-refresh only while it matters: commute window or a custom destination.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (override || inCommuteWindow()) setTick((t) => t + 1);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [override]);

  // Custom destinations fall back to the configured one after 5 minutes.
  useEffect(() => {
    if (!override) return;
    const id = window.setTimeout(() => setOverride(null), OVERRIDE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [override]);

  // Draw the selected route coloured by live speed, alternates in grey.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !result) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const b = new google.maps.LatLngBounds();

    result.routes.forEach((route, idx) => {
      const path = google.maps.geometry.encoding.decodePath(route.encodedPolyline);
      path.forEach((p) => b.extend(p));
      const tip = `${fmtMin(route.seconds)} • ${(route.meters / 1000).toFixed(1)} km${idx === selected ? '' : ' (alternate)'}`;
      const add = (line: google.maps.Polyline) => {
        line.addListener('mouseover', () => setHoverTip(tip));
        line.addListener('mouseout', () => setHoverTip(null));
        line.addListener('click', () => setSelected(idx));
        overlays.current.push(line);
      };
      if (idx !== selected) {
        add(new google.maps.Polyline({ path, map, strokeColor: ALT_ROUTE_COLOR, strokeOpacity: 0.7, strokeWeight: 4, zIndex: 1 }));
      } else if (route.intervals.length === 0) {
        add(new google.maps.Polyline({ path, map, strokeColor: SPEED_COLORS.NORMAL, strokeWeight: 6, zIndex: 2 }));
      } else {
        route.intervals.forEach((iv) => {
          const seg = path.slice(iv.start, (iv.end ?? path.length - 1) + 1);
          if (seg.length < 2) return;
          add(new google.maps.Polyline({ path: seg, map, strokeColor: SPEED_COLORS[iv.speed] ?? SPEED_COLORS.NORMAL, strokeWeight: 6, zIndex: 2 }));
        });
      }
    });
    overlays.current.push(
      new google.maps.Marker({ position: result.origin, map, label: 'A' }),
      new google.maps.Marker({ position: result.dest, map, label: 'B' }),
    );
    bounds.current = b;
    map.fitBounds(b);
  }, [result, selected, mapReady]);

  useEffect(() => {
    if (mapRef.current && bounds.current) mapRef.current.fitBounds(bounds.current);
  }, [compact]);

  const route = result?.routes[selected];
  const mins = route ? Math.round(route.seconds / 60) : 0;
  const alert = !!route && mins >= config.alertThresholdMin && inCommuteWindow(now);
  const stale = lastUpdate !== null && now.getTime() - lastUpdate > STALE_MS;
  const bestLater = leaveLater ? Math.min(...leaveLater.map((l) => l.seconds)) : 0;
  const vehicleIcon = mode === 'TWO_WHEELER' ? '🏍️' : '🚗';
  const title = override ? `Home to ${override.label}` : config.title;
  const height = compact ? config.compactHeight : mapHeight ?? config.height;

  return (
    <section className="card commute">
      <header className="card-head">
        <Icon name="car" size={18} />
        <h2 className="ellipsis">{swapped ? `${title} (return)` : title}</h2>
        {lastUpdate && (
          <span className={`small ${stale ? 'stale' : 'muted'}`}>
            {stale ? `⚠ ${timeLabel(lastUpdate)} (${Math.floor((now.getTime() - lastUpdate) / 60_000)}m ago)` : timeLabel(lastUpdate)}
          </span>
        )}
      </header>

      <div className="commute-toolbar">
        <button className={`chip-btn small ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen((s) => !s)} title="Search destination">🔍</button>
        <button className="chip-btn small" onClick={() => setTick((t) => t + 1)} title="Refresh now">↻</button>
        <button className={`chip-btn small ${swapped ? 'active' : ''}`} onClick={() => setSwapped((s) => !s)} title="Reverse direction">⇄</button>
        <button className={`chip-btn small ${compact ? 'active' : ''}`} onClick={() => setCompact((c) => !c)} title="Compact map">⤢</button>
        <button
          className="chip-btn small"
          onClick={() => setMode((m) => (m === 'DRIVE' ? 'TWO_WHEELER' : 'DRIVE'))}
          title={mode === 'TWO_WHEELER' ? 'Motorcycle routing (tap for car)' : 'Car routing (tap for motorcycle)'}
        >
          {vehicleIcon}
        </button>
      </div>

      <div className="commute-search" hidden={!searchOpen}>
        <input ref={inputRef} placeholder="Search destination…" />
        <button className="chip-btn small" onClick={() => { setOverride(null); if (inputRef.current) inputRef.current.value = ''; }}>Reset</button>
      </div>

      {recents.length > 0 && (
        <div className="chips-row">
          {recents.map((r) => (
            <button key={r.label} className={`chip-btn small ${override?.label === r.label ? 'active' : ''}`} onClick={() => choosePlace(r)}>{r.label}</button>
          ))}
        </div>
      )}
      {override && <div className="muted small ellipsis commute-dest" title={override.full}>Routing to {override.full} · resets in 5 min</div>}
      {alert && <div className="commute-alert">⚠ Heavy traffic: {mins} min. Consider leaving early.</div>}

      <div className="commute-eta">
        {status ||
          (route && (
            <>
              {vehicleIcon} <strong>{fmtMin(route.seconds)}</strong> in current traffic · {(route.meters / 1000).toFixed(1)} km
              {result!.routes.length > 1 && <span className="muted"> · {result!.routes.length - 1} alternate</span>}
            </>
          ))}
      </div>
      {leaveLater && (
        <div className="commute-later small">
          {leaveLater.map((l) => (
            <span key={l.label} className={l.seconds === bestLater ? 'best' : 'muted'}>
              {l.seconds === bestLater ? '★ ' : ''}{l.label}: {Math.round(l.seconds / 60)}m
            </span>
          ))}
        </div>
      )}

      <div className="commute-map" style={{ height }}>
        <div ref={mapDiv} className="commute-map-inner" />
        {hoverTip && <div className="commute-tip">{hoverTip}</div>}
      </div>
      <div className="commute-legend small muted">
        <span style={{ color: SPEED_COLORS.NORMAL }}>●</span> Normal <span style={{ color: SPEED_COLORS.SLOW }}>●</span> Slow{' '}
        <span style={{ color: SPEED_COLORS.TRAFFIC_JAM }}>●</span> Jam <span style={{ color: ALT_ROUTE_COLOR }}>●</span> Alternate (tap to switch)
      </div>
    </section>
  );
}
