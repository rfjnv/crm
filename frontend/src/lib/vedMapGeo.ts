/** Leaflet tile layer with English labels (Carto Voyager). */
export const VED_MAP_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

export const VED_MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> '
  + '&copy; <a href="https://carto.com/attributions">CARTO</a>';

export type LatLng = [number, number];

/** Geocode address + country via Nominatim (English names). */
export async function geocodeAddress(
  address: string,
  country?: string | null,
): Promise<LatLng | null> {
  const q = [address.trim(), country?.trim()].filter(Boolean).join(', ');
  if (!q) return null;

  const params = new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
    'accept-language': 'en',
  });

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { lat: string; lon: string }[];
  const hit = data[0];
  if (!hit) return null;

  return [Number(hit.lat), Number(hit.lon)];
}

/** Road geometry between waypoints (OSRM). Falls back to straight segments. */
export async function fetchRouteGeometry(waypoints: LatLng[]): Promise<LatLng[]> {
  if (waypoints.length < 2) return waypoints;

  const coordPath = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordPath}`
    + '?overview=full&geometries=geojson';

  try {
    const res = await fetch(url);
    if (!res.ok) return waypoints;
    const data = (await res.json()) as {
      code?: string;
      routes?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (data.code !== 'Ok' || !coords?.length) return waypoints;
    return coords.map(([lng, lat]) => [lat, lng] as LatLng);
  } catch {
    return waypoints;
  }
}

/** Great-circle distance in km (for route summary). */
export function pathDistanceKm(points: LatLng[]): number {
  if (points.length < 2) return 0;
  const R = 6371;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2
      + Math.cos((lat1 * Math.PI) / 180)
      * Math.cos((lat2 * Math.PI) / 180)
      * Math.sin(dLon / 2) ** 2;
    total += 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}
