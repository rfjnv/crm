import type { SupplierSite, VedMapRoutePoint, VedMapRoutePointPayload } from '../types';
import { displayCountryEnglish } from '../constants/vedMapCountries';

export type VedMapRouteStop =
  | { key: string; kind: 'site'; siteId: string }
  | { key: string; kind: 'pin'; latitude: number; longitude: number; label: string };

export function newRouteStopKey(): string {
  return `rs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function routeStopLabel(stop: VedMapRouteStop, sites: SupplierSite[]): string {
  if (stop.kind === 'site') {
    return sites.find((s) => s.id === stop.siteId)?.name ?? '—';
  }
  return stop.label;
}

export function routeStopSubtitle(stop: VedMapRouteStop, sites: SupplierSite[]): string {
  if (stop.kind === 'site') {
    const site = sites.find((s) => s.id === stop.siteId);
    if (!site) return '—';
    const country = displayCountryEnglish(site.country);
    return country || site.supplier.companyName;
  }
  return `${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}`;
}

export function routeStopsToWaypoints(stops: VedMapRouteStop[], sites: SupplierSite[]): [number, number][] {
  return stops
    .map((stop) => {
      if (stop.kind === 'site') {
        const site = sites.find((s) => s.id === stop.siteId);
        return site ? ([site.latitude, site.longitude] as [number, number]) : null;
      }
      return [stop.latitude, stop.longitude] as [number, number];
    })
    .filter((p): p is [number, number] => p != null);
}

export function routeStopsToPayload(stops: VedMapRouteStop[], sites: SupplierSite[]): VedMapRoutePointPayload[] {
  const payload: VedMapRoutePointPayload[] = [];
  for (const stop of stops) {
    if (stop.kind === 'site') {
      const site = sites.find((s) => s.id === stop.siteId);
      if (!site) continue;
      payload.push({
        siteId: site.id,
        label: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
      });
    } else {
      payload.push({
        siteId: null,
        label: stop.label,
        latitude: stop.latitude,
        longitude: stop.longitude,
      });
    }
  }
  return payload;
}

export function routePointsToStops(points: VedMapRoutePoint[]): VedMapRouteStop[] {
  return points.map((p) => {
    if (p.siteId) {
      return { key: newRouteStopKey(), kind: 'site' as const, siteId: p.siteId };
    }
    return {
      key: newRouteStopKey(),
      kind: 'pin' as const,
      latitude: p.latitude,
      longitude: p.longitude,
      label: p.label?.trim() || 'Map point',
    };
  });
}

export function routeOrderBySiteIdFromStops(stops: VedMapRouteStop[]): Map<string, number> {
  const map = new Map<string, number>();
  let order = 0;
  for (const stop of stops) {
    if (stop.kind !== 'site') continue;
    order += 1;
    map.set(stop.siteId, order);
  }
  return map;
}
