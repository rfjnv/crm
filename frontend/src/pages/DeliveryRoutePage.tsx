import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Grid, Progress, Spin, Typography, message } from 'antd';
import { CheckOutlined, EnvironmentOutlined, PhoneOutlined, UndoOutlined } from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { deliveryRouteApi } from '../api/deliveryRoute.api';
import { settingsApi } from '../api/settings.api';
import { VED_MAP_TILE_ATTRIBUTION, VED_MAP_TILE_URL, type LatLng } from '../lib/vedMapGeo';
import { fetchRoadRoute, yandexFromHereUrl, yandexRouteUrl, yandexToPointUrl, type RoadRoute } from '../lib/clientsMapRoute';
import {
  BASES,
  COLOR_DELIVERED,
  COLOR_ROUTE,
  DEFAULT_CENTER,
  baseIcon,
  basePoint,
  escapeHtml,
  formatDuration,
  formatTime,
  stopIcon,
} from '../lib/deliveryMap';

/** Маршрут доставки для водителя: тот же общий набор, что менеджеры собирают на карте клиентов. */
export default function DeliveryRoutePage() {
  const qc = useQueryClient();
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
  const delivered = useMemo(() => route?.delivered ?? {}, [route]);
  const remaining = stops.filter((s) => !delivered[s.id]);
  const deliveredCount = stops.length - remaining.length;

  const markMut = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => deliveryRouteApi.markDelivered(id, value),
    onSuccess: (data, { value }) => {
      qc.setQueryData(['delivery-route'], data);
      if (value) message.success('Отмечено: доставлено');
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Не удалось отметить');
      void qc.invalidateQueries({ queryKey: ['delivery-route'] });
    },
  });
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
      L.marker([s.latitude, s.longitude], { icon: stopIcon(i + 1, s.id === selectedId, !!delivered[s.id]) })
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
  }, [road, stops, delivered, selectedId, startBase, startPoint?.[0], startPoint?.[1], routePoints]);

  const showStop = (id: string, p: LatLng) => {
    setSelectedId(id);
    mapInstance.current?.flyTo(p, 16);
    if (isMobile) mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const updated = route?.updatedAt ? formatTime(route.updatedAt) : null;
  const next = remaining[0] ?? null;
  const nextIndex = next ? stops.findIndex((s) => s.id === next.id) + 1 : 0;
  const allDone = stops.length > 0 && remaining.length === 0;

  // Когда часть развезли — ведём от текущего места через оставшихся (и обратно на базу)
  const restPoints: LatLng[] = remaining.map((s) => [s.latitude, s.longitude]);
  if (startPoint && roundtrip) restPoints.push(startPoint);
  const wholeRouteHref = deliveredCount === 0
    ? (routePoints.length >= 2 ? yandexRouteUrl(routePoints) : null)
    : (restPoints.length > 0 ? yandexFromHereUrl(restPoints) : null);

  const phoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

  const header = (
    <div>
      <Typography.Title level={4} style={{ margin: 0 }}>Мой маршрут</Typography.Title>
      {stops.length > 0 && (
        <div style={{ maxWidth: 480, marginTop: 4 }}>
          <Typography.Text style={{ fontSize: 15 }}>
            Доставлено <b>{deliveredCount}</b> из <b>{stops.length}</b>
            {road ? ` · ${road.distanceKm.toFixed(0)} км, ≈ ${formatDuration(road.durationMin)}` : ''}
          </Typography.Text>
          <Progress
            percent={Math.round((deliveredCount / stops.length) * 100)}
            showInfo={false}
            strokeColor={COLOR_ROUTE}
          />
        </div>
      )}
      {!startPoint && stops.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          title={`${BASES[startBase].title} не отмечен на карте — маршрут без точки выезда`}
        />
      )}
    </div>
  );

  /** Главное на экране водителя: куда ехать сейчас и кнопка «Доставлено». */
  const nextCard = next ? (
    <Card
      size="small"
      style={{ borderColor: COLOR_ROUTE, borderWidth: 2 }}
      styles={{ body: { padding: 14 } }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        Следующая остановка · №{nextIndex}
      </Typography.Text>
      <Typography.Title level={4} style={{ margin: '2px 0 4px' }}>{next.companyName}</Typography.Title>
      {next.address && <div style={{ fontSize: 15 }}>{next.address}</div>}
      <div style={{ fontSize: 14, color: 'var(--ant-color-text-secondary, #8c8c8c)' }}>
        {next.contactName}{next.phone ? ` · ${next.phone}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button
          size="large"
          icon={<EnvironmentOutlined />}
          href={yandexToPointUrl([next.latitude, next.longitude])}
          target="_blank"
          style={{ flex: 1 }}
        >
          Поехать
        </Button>
        {next.phone && (
          <Button size="large" icon={<PhoneOutlined />} href={phoneHref(next.phone)} style={{ flex: 1 }}>
            Позвонить
          </Button>
        )}
      </div>
      <Button
        type="primary"
        size="large"
        block
        icon={<CheckOutlined />}
        loading={markMut.isPending && markMut.variables?.id === next.id}
        style={{ marginTop: 8, background: COLOR_ROUTE, height: 52, fontSize: 17 }}
        onClick={() => markMut.mutate({ id: next.id, value: true })}
      >
        Доставлено
      </Button>
    </Card>
  ) : allDone ? (
    <Card size="small" style={{ borderColor: COLOR_ROUTE }} styles={{ body: { padding: 14 } }}>
      <Typography.Title level={4} style={{ margin: 0, color: COLOR_ROUTE }}>
        <CheckOutlined /> Все доставлены
      </Typography.Title>
      {startPoint && roundtrip && (
        <Button
          type="primary"
          size="large"
          block
          icon={<EnvironmentOutlined />}
          href={yandexToPointUrl(startPoint)}
          target="_blank"
          style={{ marginTop: 12 }}
        >
          Обратно: {BASES[startBase].title.toLowerCase()}
        </Button>
      )}
    </Card>
  ) : null;

  const list = stops.length === 0 ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={isLoading ? 'Загрузка…' : 'Маршрута пока нет — его собирают менеджеры. Страница обновится сама.'}
    />
  ) : (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <Typography.Text strong style={{ fontSize: 15 }}>Все остановки</Typography.Text>
        {wholeRouteHref && !allDone && (
          <Button size="small" icon={<EnvironmentOutlined />} href={wholeRouteHref} target="_blank">
            {deliveredCount ? 'Оставшиеся в Яндексе' : 'Весь маршрут в Яндексе'}
          </Button>
        )}
      </div>
      {startPoint && (
        <div style={{ padding: '6px 0', color: BASES[startBase].color }}>
          {BASES[startBase].emoji} Выезд: {BASES[startBase].title.toLowerCase()}
        </div>
      )}
      {stops.map((s, i) => {
        const mark = delivered[s.id];
        const busy = markMut.isPending && markMut.variables?.id === s.id;
        const isNext = next?.id === s.id;
        return (
          <div
            key={s.id}
            style={{
              display: 'flex', gap: 10, padding: '8px 0', alignItems: 'center',
              borderTop: '1px solid var(--ant-color-split, #f0f0f0)',
              background: s.id === selectedId ? 'rgba(250,173,20,.12)' : undefined,
            }}
          >
            <span style={{
              minWidth: 26, height: 26, borderRadius: 13, background: mark ? COLOR_DELIVERED : COLOR_ROUTE,
              color: '#fff', fontWeight: 700, lineHeight: '26px', textAlign: 'center', flex: 'none',
            }}>{mark ? '✓' : i + 1}</span>
            <div
              style={{ flex: 1, minWidth: 0, cursor: 'pointer', opacity: mark ? 0.6 : 1 }}
              onClick={() => showStop(s.id, [s.latitude, s.longitude])}
            >
              <Typography.Text strong={isNext} delete={!!mark} style={{ display: 'block' }}>
                {s.companyName}{isNext ? ' — следующая' : ''}
              </Typography.Text>
              {mark ? (
                <Typography.Text type="success" style={{ display: 'block', fontSize: 12 }}>
                  Доставлено {formatTime(mark.at)}{mark.byName ? ` · ${mark.byName}` : ''}
                </Typography.Text>
              ) : s.address && (
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13 }}>{s.address}</Typography.Text>
              )}
            </div>
            {mark ? (
              <Button size="small" type="link" icon={<UndoOutlined />} loading={busy} onClick={() => markMut.mutate({ id: s.id, value: false })}>
                Отменить
              </Button>
            ) : !isNext && (
              <Button size="small" icon={<CheckOutlined />} loading={busy} onClick={() => markMut.mutate({ id: s.id, value: true })}>
                Доставлено
              </Button>
            )}
          </div>
        );
      })}
      {startPoint && roundtrip && (
        <div style={{ padding: '6px 0', color: BASES[startBase].color, borderTop: '1px solid var(--ant-color-split, #f0f0f0)' }}>
          {BASES[startBase].emoji} Возврат: {BASES[startBase].title.toLowerCase()}
        </div>
      )}
      {updated && (
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
          Маршрут составил{route?.updatedByName ? ` ${route.updatedByName}` : 'и'}, {updated}
        </Typography.Text>
      )}
    </div>
  );

  if (isError) {
    return <Alert type="error" showIcon title="Не удалось загрузить маршрут доставки" />;
  }

  const mapCard = (
    <Card
      size="small"
      style={isMobile ? { width: '100%', height: '40vh' } : { flex: 1 }}
      styles={{ body: { padding: 0, height: '100%' } }}
    >
      <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 8 }} />
    </Card>
  );

  const listCard = (
    <Card size="small">
      {isLoading ? <Spin style={{ display: 'block', margin: '40px auto' }} /> : list}
    </Card>
  );

  // Одно дерево для телефона и компьютера: иначе при смене ширины карта пересоздаётся и пропадает
  return (
    <div style={isMobile
      ? { display: 'flex', flexDirection: 'column', gap: 12 }
      : { display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 120px)', minHeight: 520 }}
    >
      {header}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, flex: 1, minHeight: 0 }}>
        <div style={isMobile
          ? { display: 'contents' }
          : { width: 420, flex: 'none', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {nextCard && <div style={{ order: 0 }}>{nextCard}</div>}
          <div style={{ order: 2 }}>{listCard}</div>
        </div>
        <div style={isMobile ? { order: 1 } : { flex: 1, minWidth: 300, display: 'flex' }}>{mapCard}</div>
      </div>
    </div>
  );
}
