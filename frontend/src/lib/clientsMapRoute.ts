/**
 * Маршрут доставки по клиентам: порядок объезда и дорога между точками.
 * Матрица времени и геометрия — публичный OSRM (без ключа); если он не ответил,
 * считаем по прямой, чтобы маршрут всё равно строился.
 */
import { pathDistanceKm, type LatLng } from './vedMapGeo';

const OSRM = 'https://router.project-osrm.org';
/** Публичный OSRM принимает до 100 точек в запросе. */
export const MAX_ROUTE_POINTS = 100;
/** Средняя скорость по городу для оценки, когда OSRM недоступен. */
const FALLBACK_KMH = 30;

function coordPath(points: LatLng[]): string {
  return points.map(([lat, lng]) => `${lng},${lat}`).join(';');
}

function straightMatrix(points: LatLng[]): number[][] {
  return points.map((a) => points.map((b) => (pathDistanceKm([a, b]) / FALLBACK_KMH) * 3600));
}

/** Время в пути (сек) между каждой парой точек. */
async function fetchDurationMatrix(points: LatLng[]): Promise<number[][]> {
  try {
    const res = await fetch(`${OSRM}/table/v1/driving/${coordPath(points)}?annotations=duration`);
    if (!res.ok) return straightMatrix(points);
    const data = (await res.json()) as { code?: string; durations?: (number | null)[][] };
    if (data.code !== 'Ok' || !data.durations) return straightMatrix(points);
    const fallback = straightMatrix(points);
    return data.durations.map((row, i) => row.map((v, j) => v ?? fallback[i][j]));
  } catch {
    return straightMatrix(points);
  }
}

function tourCost(order: number[], m: number[][], roundtrip: boolean): number {
  let cost = 0;
  for (let i = 1; i < order.length; i += 1) cost += m[order[i - 1]][order[i]];
  if (roundtrip && order.length > 1) cost += m[order[order.length - 1]][order[0]];
  return cost;
}

/**
 * Порядок объезда: ближайший сосед, потом 2-opt. Точка 0 — старт (склад/офис), она не двигается.
 * Возвращает индексы остановок (0-based, без старта) в порядке объезда.
 */
export async function optimizeStopOrder(
  start: LatLng,
  stops: LatLng[],
  roundtrip: boolean,
): Promise<number[]> {
  if (stops.length < 2) return stops.map((_, i) => i);
  const points = [start, ...stops];
  const m = await fetchDurationMatrix(points);

  const order = [0];
  const left = new Set(stops.map((_, i) => i + 1));
  while (left.size) {
    const last = order[order.length - 1];
    let best = -1;
    for (const j of left) if (best < 0 || m[last][j] < m[last][best]) best = j;
    order.push(best);
    left.delete(best);
  }

  let bestCost = tourCost(order, m, roundtrip);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < order.length - 1; i += 1) {
      for (let k = i + 1; k < order.length; k += 1) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const cost = tourCost(candidate, m, roundtrip);
        if (cost < bestCost - 1e-6) {
          order.splice(0, order.length, ...candidate);
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return order.slice(1).map((i) => i - 1);
}

export interface RoadRoute {
  geometry: LatLng[];
  distanceKm: number;
  durationMin: number;
  /** true — OSRM не ответил, линия и цифры по прямой. */
  approximate: boolean;
}

/** Дорога через точки в заданном порядке. */
export async function fetchRoadRoute(points: LatLng[]): Promise<RoadRoute> {
  const straight = (): RoadRoute => {
    const km = pathDistanceKm(points);
    return { geometry: points, distanceKm: km, durationMin: (km / FALLBACK_KMH) * 60, approximate: true };
  };
  if (points.length < 2) return straight();
  try {
    const res = await fetch(
      `${OSRM}/route/v1/driving/${coordPath(points)}?overview=full&geometries=geojson`,
    );
    if (!res.ok) return straight();
    const data = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number; geometry?: { coordinates?: [number, number][] } }[];
    };
    const route = data.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (data.code !== 'Ok' || !route || !coords?.length) return straight();
    return {
      geometry: coords.map(([lng, lat]) => [lat, lng] as LatLng),
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      approximate: false,
    };
  } catch {
    return straight();
  }
}

export function yandexRouteUrl(points: LatLng[]): string {
  const rtext = points.map(([lat, lng]) => `${lat},${lng}`).join('~');
  return `https://yandex.uz/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`;
}

/** Маршрут от текущего места водителя через точки — когда часть уже развезли. */
export function yandexFromHereUrl(points: LatLng[]): string {
  const rtext = ['', ...points.map(([lat, lng]) => `${lat},${lng}`)].join('~');
  return `https://yandex.uz/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`;
}

/** Маршрут от текущего места до одной точки — для водителя «поехать сюда». */
export function yandexToPointUrl(point: LatLng): string {
  return yandexFromHereUrl([point]);
}
