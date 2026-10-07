import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Grid, Space, Spin, Tag, Typography } from 'antd';
import { EnvironmentOutlined, PhoneOutlined } from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { deliveryRouteApi } from '../api/deliveryRoute.api';
import { settingsApi } from '../api/settings.api';
import { VED_MAP_TILE_ATTRIBUTION, VED_MAP_TILE_URL, type LatLng } from '../lib/vedMapGeo';
import { fetchRoadRoute, yandexRouteUrl, yandexToPointUrl, type RoadRoute } from '../lib/clientsMapRoute';
import {
  BASES,
  COLOR_ROUTE,
  DEFAULT_CENTER,
  baseIcon,
  basePoint,
  escapeHtml,
  formatDuration,
  stopIcon,
} from '../lib/deliveryMap';

/** Маршрут доставки для водителя: тот же общий набор, что менеджеры собирают на карте клиентов. */
export default function DeliveryRoutePage() {
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fittedKey = useRef('');
  const [road, setRoad] = useState<RoadRoute | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: route, isLoading, isError } = useQuery({
    queryKey: ['delivery-route'],
    queryFn: deliveryRouteApi.get,
    refetchInterval: 30_000,
  });
  const { data: settings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
  });

  const stops = useMemo(() => route?.stops ?? [], [route]);
  const startBase = route?.startBase ?? 'WAREHOUSE';
  const startPoint = basePoint(settings, startBase);
  const roundtrip = route?.roundtrip ?? true;

  const routePoints = useMemo<LatLng[]>(() => {
    const pts = stops.map((s) => [s.latitude, s.longitude] as LatLng);
    if (!startPoint) return pts;
    return roundtrip ? [startPoint, ...pts, startPoint] : [startPoint, ...pts];
    // startPoint — новый массив на каждый рендер, зависим от чисел
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, startPoint?.[0], startPoint?.[1], roundtrip]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return undefined;
    const map = L.map(mapRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, 11);
    L.tileLayer(VED_MAP_TILE_URL, { attribution: VED_MAP_TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    layer.current = L.layerGroup().addTo(map);
    mapInstance.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(mapRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapInstance.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    if (routePoints.length < 2) {
      setRoad(null);
      return undefined;
    }
    let cancelled = false;
    void fetchRoadRoute(routePoints).then((r) => {
      if (!cancelled) setRoad(r);
    });
    return () => {
      cancelled = true;
    };
  }, [routePoints]);

  useEffect(() => {
    const map = mapInstance.current;
    const lg = layer.current;
    if (!map || !lg) return;
    lg.clearLayers();
    if (road && road.geometry.length > 1) {
      L.polyline(road.geometry, {
        color: COLOR_ROUTE, weight: 5, opacity: 0.75, dashArray: road.approximate ? '8 8' : undefined,
      }).addTo(lg);
    }
    if (startPoint) {
      L.marker(startPoint, { icon: baseIcon(startBase), zIndexOffset: 1000 })
        .bindTooltip(BASES[startBase].title, { direction: 'top', offset: [0, -18] })
        .addTo(lg);
    }
    stops.forEach((s, i) => {
      L.marker([s.latitude, s.longitude], { icon: stopIcon(i + 1, s.id === selectedId) })
        .bindTooltip(`<b>${escapeHtml(s.companyName)}</b>${s.address ? `<br/>${escapeHtml(s.address)}` : ''}`, {
          direction: 'top', offset: [0, -12],
        })
        .on('click', () => setSelectedId(s.id))
        .addTo(lg);
    });
    // Подгоняем вид только когда сменился сам набор точек, а не при каждом обновлении
    const key = routePoints.map((p) => p.join(',')).join(';');
    if (key && key !== fittedKey.current) {
      fittedKey.current = key;
      if (routePoints.length === 1) map.setView(routePoints[0], 15);
      else map.fitBounds(L.latLngBounds(routePoints), { padding: [30, 30] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [road, stops, selectedId, startBase, startPoint?.[0], startPoint?.[1], routePoints]);

  const showStop = (id: string, p: LatLng) => {
    setSelectedId(id);
    mapInstance.current?.flyTo(p, 16);
    if (isMobile) mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const updated = route?.updatedAt
    ? new Date(route.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  const header = (
    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>Маршрут доставки</Typography.Title>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {stops.length} остановок · старт: {BASES[startBase].emoji} {BASES[startBase].title}
        {roundtrip ? ' (с возвратом)' : ''}
        {updated ? ` · обновлён ${updated}${route?.updatedByName ? `, ${route.updatedByName}` : ''}` : ''}
      </Typography.Text>
      {road && (
        <Space wrap size={12}>
          <span><b>{road.distanceKm.toFixed(1)} км</b></span>
          <span>≈ {formatDuration(road.durationMin)} в пути</span>
          {road.approximate && <Tag color="orange">по прямой — сервис дорог не ответил</Tag>}
        </Space>
      )}
      {routePoints.length >= 2 && (
        <Button
          type="primary"
          size="large"
          block={isMobile}
          icon={<EnvironmentOutlined />}
          href={yandexRouteUrl(routePoints)}
          target="_blank"
        >
          Открыть в Яндекс Картах
        </Button>
      )}
      {!startPoint && stops.length > 0 && (
        <Alert type="warning" showIcon title={`${BASES[startBase].title} не отмечен на карте — маршрут без точки старта`} />
      )}
    </Space>
  );

  const list = stops.length === 0 ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={isLoading ? 'Загрузка…' : 'Маршрут пуст — менеджеры собирают его на карте клиентов'}
    />
  ) : (
    <div>
      {startPoint && (
        <div style={{ padding: '6px 0', color: BASES[startBase].color }}>
          {BASES[startBase].emoji} {BASES[startBase].title} — старт
        </div>
      )}
      {stops.map((s, i) => (
        <div
          key={s.id}
          style={{
            display: 'flex', gap: 10, padding: '8px 0', alignItems: 'flex-start',
            borderTop: '1px solid var(--ant-color-split, #f0f0f0)',
            background: s.id === selectedId ? 'rgba(250,173,20,.12)' : undefined,
          }}
        >
          <span style={{
            minWidth: 26, height: 26, borderRadius: 13, background: COLOR_ROUTE, color: '#fff',
            fontWeight: 700, lineHeight: '26px', textAlign: 'center', flex: 'none',
          }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => showStop(s.id, [s.latitude, s.longitude])}>
            <Typography.Text strong style={{ display: 'block' }}>{s.companyName}</Typography.Text>
            {s.address && <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13 }}>{s.address}</Typography.Text>}
            <Typography.Text style={{ display: 'block', fontSize: 13 }}>{s.contactName}</Typography.Text>
          </div>
          <Space orientation="vertical" size={4} style={{ flex: 'none' }}>
            {s.phone && (
              <Button size="small" icon={<PhoneOutlined />} href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>
                Позвонить
              </Button>
            )}
            <Button
              size="small"
              icon={<EnvironmentOutlined />}
              href={yandexToPointUrl([s.latitude, s.longitude])}
              target="_blank"
            >
              Сюда
            </Button>
          </Space>
        </div>
      ))}
      {startPoint && roundtrip && (
        <div style={{ padding: '6px 0', color: BASES[startBase].color, borderTop: '1px solid var(--ant-color-split, #f0f0f0)' }}>
          {BASES[startBase].emoji} {BASES[startBase].title} — возврат
        </div>
      )}
    </div>
  );

  if (isError) {
    return <Alert type="error" showIcon title="Не удалось загрузить маршрут доставки" />;
  }

  return (
    <div style={isMobile
      ? { display: 'flex', flexDirection: 'column', gap: 12 }
      : { display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 120px)', minHeight: 520 }}
    >
      {header}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, flexDirection: isMobile ? 'column' : 'row' }}>
        <Card
          size="small"
          style={isMobile ? { width: '100%', height: '55vh' } : { flex: 1, minWidth: 300 }}
          styles={{ body: { padding: 0, height: '100%' } }}
        >
          <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 8 }} />
        </Card>
        <Card
          size="small"
          style={isMobile ? { width: '100%' } : { width: 400, overflow: 'hidden' }}
          styles={{ body: isMobile ? {} : { overflowY: 'auto', height: '100%' } }}
        >
          {isLoading ? <Spin style={{ display: 'block', margin: '40px auto' }} /> : list}
        </Card>
      </div>
    </div>
  );
}
