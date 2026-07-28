// =============================================================================
// FireISP 5.0 — MapTiles
// =============================================================================
// THE single tile layer for every map in the product. Three pages previously
// hardcoded OpenStreetMap's public tile server, so changing provider meant
// editing three files and hoping you found them all.
//
// OSM stays the default: no account, no API key, no signup, so a fresh install
// has working maps immediately. An operator who needs something else — because
// OSM's usage policy is aimed at modest use, or because they already pay for
// tiles — sets map_tile_url in settings and every map follows.
//
// Any XYZ raster provider works by URL alone. Google does NOT: its terms
// require the Google Maps JavaScript API, a different renderer rather than a
// different URL, so it would need its own component.
//
// The query never fails the map. If /map-config is unreachable the constants
// below render, because a broken settings lookup should not turn every map
// into a grey square.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { TileLayer } from 'react-leaflet';
import { api } from '@/api/client';

export const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

interface MapConfig {
  tile_url: string;
  attribution: string;
  is_default: boolean;
}

async function fetchMapConfig(): Promise<MapConfig> {
  const res = await api.GET('/map-config', {});
  if (res.error) throw new Error('map config unavailable');
  return (res.data as unknown as { data: MapConfig }).data;
}

export function MapTiles() {
  const { data } = useQuery({
    queryKey: ['map-config'],
    queryFn: fetchMapConfig,
    // Install-level config: it does not change while someone is looking at a
    // map, and re-fetching it per map mount is pure noise.
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  return (
    <TileLayer
      url={data?.tile_url || DEFAULT_TILE_URL}
      attribution={data?.attribution || DEFAULT_ATTRIBUTION}
    />
  );
}

export default MapTiles;
