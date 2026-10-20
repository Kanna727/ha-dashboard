// The commute map and place search on Google Maps JS (loaded only when shown).
// The mock swaps both out (see views.tsx), since it has no API key.
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from './googleMaps';
import { ALT_ROUTE_COLOR, fmtMin, kmText, SPEED_COLORS } from './routes';
import type { MapViewProps, PlaceSearchProps } from './views';

function shortPlaceLabel(name: string | undefined, address: string | undefined): string {
  const n = name?.trim();
  const a = address ?? '';
  if (n && n !== a.trim() && !a.startsWith(n + ',')) return n;
  return a.split(',')[0].trim() || n || a || 'destination';
}

// Map + traffic layer in the dashboard's dark scheme; the selected route is
// drawn by live speed, alternates in grey (tap one to pick it).
export function GoogleMapView({ config, routes, origin, dest, selected, onSelect, height, padding }: MapViewProps) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlays = useRef<(google.maps.Polyline | google.maps.Marker)[]>([]);
  const bounds = useRef<google.maps.LatLngBounds | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [tip, setTip] = useState<string | null>(null);

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
        setReady(true);
      })
      .catch((e) => setError(`Couldn't load Google Maps: ${e.message}`));
    return () => {
      cancelled = true;
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      mapRef.current = null;
    };
  }, [config]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routes || !origin || !dest) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const b = new google.maps.LatLngBounds();
    routes.forEach((route, idx) => {
      const path = google.maps.geometry.encoding.decodePath(route.encodedPolyline);
      path.forEach((p) => b.extend(p));
      const text = `${fmtMin(route.seconds)} · ${kmText(route.meters)}${idx === selected ? '' : ' · tap to use'}`;
      const add = (line: google.maps.Polyline) => {
        line.addListener('mouseover', () => setTip(text));
        line.addListener('mouseout', () => setTip(null));
        line.addListener('click', () => onSelect(idx));
        overlays.current.push(line);
      };
      if (idx !== selected) {
        add(new google.maps.Polyline({ path, map, strokeColor: ALT_ROUTE_COLOR, strokeOpacity: 0.7, strokeWeight: 5, zIndex: 1 }));
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
    overlays.current.push(new google.maps.Marker({ position: origin, map, label: 'A' }), new google.maps.Marker({ position: dest, map, label: 'B' }));
    bounds.current = b;
    map.fitBounds(b, padding ?? 24);
  }, [routes, origin, dest, selected, onSelect, ready, padding]);

  // Refit when the box changes size (layouts, phone rotation).
  useEffect(() => {
    if (!mapDiv.current) return;
    const ro = new ResizeObserver(() => mapRef.current && bounds.current && mapRef.current.fitBounds(bounds.current, padding ?? 24));
    ro.observe(mapDiv.current);
    return () => ro.disconnect();
  }, [padding]);

  return (
    <div className="commute-map" style={{ height }}>
      <div ref={mapDiv} className="commute-map-inner" />
      {error && <div className="commute-map-msg muted small">{error}</div>}
      {tip && <div className="commute-tip">{tip}</div>}
    </div>
  );
}

// Places Autocomplete on a plain input, biased to the commute area.
export function GooglePlaceSearch({ config, onPlace, placeholder = 'Search a destination…' }: PlaceSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  const cb = useRef(onPlace);
  cb.current = onPlace;
  useEffect(() => {
    let cancelled = false;
    let listener: google.maps.MapsEventListener | undefined;
    loadGoogleMaps(config.apiKey)
      .then(() => {
        if (cancelled || !input.current) return;
        const ac = new google.maps.places.Autocomplete(input.current, {
          fields: ['geometry', 'formatted_address', 'name'],
          bounds: new google.maps.Circle({ center: config.center, radius: 40_000 }).getBounds() ?? undefined,
        });
        listener = ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          const loc = place.geometry?.location;
          if (!loc) return;
          cb.current({
            latLng: { lat: loc.lat(), lng: loc.lng() },
            label: shortPlaceLabel(place.name, place.formatted_address),
            full: place.formatted_address || place.name || '',
          });
          if (input.current) input.current.value = '';
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, [config]);
  return <input ref={input} className="commute-input" placeholder={placeholder} />;
}
