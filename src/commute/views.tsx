// The commute's map and place search. Google in the app; the mock registers
// offline stand-ins (mock/commute.tsx) so the designs can be tried locally.
import type { ComponentType } from 'react';
import { GoogleMapView, GooglePlaceSearch } from './GoogleMap';
import type { CommuteConfig, LatLng, Route } from './routes';

export interface Place {
  latLng: LatLng;
  label: string;
  full: string;
}

export interface MapViewProps {
  config: CommuteConfig;
  routes: Route[] | null;
  origin?: LatLng;
  dest?: LatLng;
  selected: number;
  onSelect: (idx: number) => void;
  height: number | string;
  // Room to keep clear of controls drawn over the map, in px.
  padding?: { top: number; right: number; bottom: number; left: number };
}

export interface PlaceSearchProps {
  config: CommuteConfig;
  onPlace: (p: Place) => void;
  placeholder?: string;
}

const views: { MapView: ComponentType<MapViewProps>; PlaceSearch: ComponentType<PlaceSearchProps> } = {
  MapView: GoogleMapView,
  PlaceSearch: GooglePlaceSearch,
};

export const setCommuteViews = (v: Partial<typeof views>) => Object.assign(views, v);

export function CommuteMapView(props: MapViewProps) {
  const V = views.MapView;
  return <V {...props} />;
}

export function PlaceSearch(props: PlaceSearchProps) {
  const V = views.PlaceSearch;
  return <V {...props} />;
}
