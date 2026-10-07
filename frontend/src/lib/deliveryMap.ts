/** Общее для карты клиентов и страницы маршрута водителя: офис/склад, значки, форматирование. */
import L from 'leaflet';
import type { LatLng } from './vedMapGeo';
import type { CompanySettings } from '../types';

export type BaseKind = 'WAREHOUSE' | 'OFFICE';

export const BASES: Record<BaseKind, {
  title: string;
  emoji: string;
  color: string;
  address: 'warehouseAddress' | 'officeAddress';
  lat: 'warehouseLatitude' | 'officeLatitude';
  lng: 'warehouseLongitude' | 'officeLongitude';
}> = {
  WAREHOUSE: {
    title: 'Склад', emoji: '🏭', color: '#d4380d',
    address: 'warehouseAddress', lat: 'warehouseLatitude', lng: 'warehouseLongitude',
  },
  OFFICE: {
    title: 'Офис', emoji: '🏢', color: '#531dab',
    address: 'officeAddress', lat: 'officeLatitude', lng: 'officeLongitude',
  },
};

export const COLOR_ROUTE = '#389e0d';
/** Центр Ташкента — пока нет ни одной точки. */
export const DEFAULT_CENTER: LatLng = [41.3111, 69.2797];

export function basePoint(settings: CompanySettings | undefined, kind: BaseKind): LatLng | null {
  if (!settings) return null;
  const lat = settings[BASES[kind].lat];
  const lng = settings[BASES[kind].lng];
  return lat != null && lng != null ? [lat, lng] : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

export function formatDuration(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

export function baseIcon(kind: BaseKind): L.DivIcon {
  const b = BASES[kind];
  return L.divIcon({
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    html: `<div style="width:38px;height:38px;border-radius:10px;background:#fff;border:3px solid ${b.color};
      box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:20px;">${b.emoji}</div>`,
  });
}

export function stopIcon(n: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="width:26px;height:26px;border-radius:13px;background:${COLOR_ROUTE};color:#fff;
      border:2px solid ${selected ? '#faad14' : '#fff'};box-shadow:0 1px 5px rgba(0,0,0,.35);
      font:700 12px/22px sans-serif;text-align:center;">${n}</div>`,
  });
}
