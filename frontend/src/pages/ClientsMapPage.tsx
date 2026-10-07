import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Grid,
  Input,
  Modal,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  AimOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { clientsApi } from '../api/clients.api';
import { settingsApi } from '../api/settings.api';
import { useAuthStore } from '../store/authStore';
import { safeStorage } from '../lib/safeStorage';
import {
  VED_MAP_TILE_ATTRIBUTION,
  VED_MAP_TILE_URL,
  geocodeAddress,
  type LatLng,
} from '../lib/vedMapGeo';
import {
  BASES,
  COLOR_ROUTE,
  DEFAULT_CENTER,
  baseIcon,
  basePoint,
  escapeHtml,
  formatDuration,
  formatTime,
  COLOR_DELIVERED,
  stopIcon,
  type BaseKind,
} from '../lib/deliveryMap';
import { deliveryRouteApi, type DeliveryRoutePayload } from '../api/deliveryRoute.api';
import {
  MAX_ROUTE_POINTS,
  fetchRoadRoute,
  optimizeStopOrder,
  yandexRouteUrl,
  type RoadRoute,
} from '../lib/clientsMapRoute';
import type { ClientMapPoint, CompanySettings } from '../types';

const COLOR_CLIENT = '#1677ff';
const COLOR_PENDING = '#fa8c16';

/** Набор маршрута раньше жил только в браузере — переносим его в общий маршрут один раз. */
const LEGACY_STORAGE_KEY = 'clientsMap.route.v1';

function takeLegacyRouteIds(): string[] {
  try {
    const raw = safeStorage.getItem(LEGACY_STORAGE_KEY);
    safeStorage.removeItem(LEGACY_STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as { ids?: unknown }).ids : null;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

type Placing =
  | { kind: 'client'; client: ClientMapPoint }
  | { kind: 'base'; base: BaseKind };

interface PendingPlacement {
  placing: Placing;
  latLng: LatLng;
  address: string;
}

function hasCoords(c: ClientMapPoint): c is ClientMapPoint & { latitude: number; longitude: number } {
  return c.latitude != null && c.longitude != null;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export default function ClientsMapPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canEditClient = isAdmin || (user?.permissions ?? []).includes('edit_client');

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const clientsLayer = useRef<L.LayerGroup | null>(null);
  const basesLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const placingRef = useRef<Placing | null>(null);
  const fittedRef = useRef(false);
  const settingsRef = useRef<CompanySettings | undefined>(undefined);

  // Рабочая копия общего маршрута: правки видны сразу, на сервер уходят с задержкой
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [start, setStart] = useState<BaseKind>('WAREHOUSE');
  const [roundtrip, setRoundtrip] = useState(true);
  const [routeReady, setRouteReady] = useState(false);
  const dirtyRef = useRef(false);
  const editSeqRef = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [tab, setTab] = useState<'route' | 'clients'>('route');
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [pending, setPending] = useState<PendingPlacement | null>(null);
  const [road, setRoad] = useState<RoadRoute | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients-map'],
    queryFn: clientsApi.mapPoints,
  });
  const { data: settings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
  });

  const { data: shared } = useQuery({
    queryKey: ['delivery-route'],
    queryFn: deliveryRouteApi.get,
    refetchInterval: 30_000,
  });

  settingsRef.current = settings;

  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const located = useMemo(() => clients.filter(hasCoords), [clients]);

  // Клиенты, которых удалили, заархивировали или убрали с карты, выпадают из маршрута
  const routeClients = useMemo(
    () => routeIds.map((id) => byId.get(id)).filter((c): c is ClientMapPoint & { latitude: number; longitude: number } => !!c && hasCoords(c)),
    [routeIds, byId],
  );
  const routeOrder = useMemo(() => new Map(routeClients.map((c, i) => [c.id, i + 1])), [routeClients]);
  // Отметки водителя; для клиентов, которых убрали из маршрута, отметки нет
  const delivered = useMemo(() => shared?.delivered ?? {}, [shared]);
  const deliveredInRoute = routeClients.filter((c) => delivered[c.id]).length;
  const startPoint = basePoint(settings, start);

  const routePoints = useMemo<LatLng[]>(() => {
    const stops = routeClients.map((c) => [c.latitude, c.longitude] as LatLng);
    if (!startPoint) return stops;
    return roundtrip ? [startPoint, ...stops, startPoint] : [startPoint, ...stops];
    // startPoint — новый массив на каждый рендер, зависим от чисел
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeClients, startPoint?.[0], startPoint?.[1], roundtrip]);

  const pendingClients = useMemo(() => located.filter((c) => c.pendingDeliveryDeals > 0), [located]);
  const pendingNotInRoute = pendingClients.filter((c) => !routeOrder.has(c.id)).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (onlyPending && c.pendingDeliveryDeals === 0) return false;
      if (!q) return true;
      return [c.companyName, c.contactName, c.address, c.phone].some((v) => v?.toLowerCase().includes(q));
    });
  }, [clients, search, onlyPending]);
  const filteredLocated = filtered.filter(hasCoords);
  const filteredUnlocated = filtered.filter((c) => !hasCoords(c));

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const markEdited = () => {
    dirtyRef.current = true;
    editSeqRef.current += 1;
  };
  const editRouteIds: typeof setRouteIds = (v) => {
    markEdited();
    setRouteIds(v);
  };
  const editStart = (v: BaseKind) => {
    markEdited();
    setStart(v);
  };
  const editRoundtrip = (v: boolean) => {
    markEdited();
    setRoundtrip(v);
  };

  const saveRouteMut = useMutation({
    mutationFn: ({ payload }: { payload: DeliveryRoutePayload; seq: number }) => deliveryRouteApi.save(payload),
    onSuccess: (data, { seq }) => {
      if (seq === editSeqRef.current) dirtyRef.current = false;
      qc.setQueryData(['delivery-route'], data);
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Маршрут не сохранился');
    },
  });

  // Чужие правки (другой менеджер) подтягиваем, пока у нас нет несохранённых
  useEffect(() => {
    if (!shared || dirtyRef.current) return;
    if (!routeReady) {
      setRouteReady(true);
      const legacy = shared.clientIds.length === 0 ? takeLegacyRouteIds() : [];
      if (legacy.length) {
        markEdited();
        setRouteIds(legacy);
        setStart(shared.startBase);
        setRoundtrip(shared.roundtrip);
        return;
      }
    }
    setRouteIds(shared.clientIds);
    setStart(shared.startBase);
    setRoundtrip(shared.roundtrip);
  }, [shared, routeReady]);

  useEffect(() => {
    if (!dirtyRef.current) return undefined;
    const seq = editSeqRef.current;
    const t = window.setTimeout(() => {
      saveRouteMut.mutate({ payload: { clientIds: routeIds, startBase: start, roundtrip }, seq });
    }, 600);
    return () => window.clearTimeout(t);
    // saveRouteMut меняется каждый рендер, сохранять нужно только по правкам
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIds, start, roundtrip]);

  useEffect(() => {
    placingRef.current = placing;
    const el = mapRef.current;
    if (el) el.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  const toggleInRoute = (id: string) => {
    if (!routeReady) return;
    editRouteIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_ROUTE_POINTS - 2) {
        message.warning(`В одном маршруте не больше ${MAX_ROUTE_POINTS - 2} клиентов`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const moveStop = (id: string, dir: -1 | 1) => {
    editRouteIds((prev) => {
      const ids = prev.filter((x) => routeOrder.has(x));
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return ids;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return ids;
    });
  };

  const addAllPending = () => {
    editRouteIds((prev) => {
      const next = [...prev];
      for (const c of pendingClients) {
        if (next.length >= MAX_ROUTE_POINTS - 2) break;
        if (!next.includes(c.id)) next.push(c.id);
      }
      message.success(`В маршруте ${next.length} клиентов`);
      return next;
    });
  };

  const optimize = async () => {
    if (!startPoint) {
      message.warning(`Сначала укажите на карте: ${BASES[start].title.toLowerCase()}`);
      return;
    }
    setOptimizing(true);
    try {
      const order = await optimizeStopOrder(
        startPoint,
        routeClients.map((c) => [c.latitude, c.longitude] as LatLng),
        roundtrip,
      );
      editRouteIds(order.map((i) => routeClients[i].id));
      message.success('Порядок объезда пересчитан');
    } finally {
      setOptimizing(false);
    }
  };

  const updateClientMut = useMutation({
    mutationFn: ({ id, latLng }: { id: string; latLng: LatLng }) =>
      clientsApi.update(id, { latitude: latLng[0], longitude: latLng[1] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients-map'] });
      message.success('Клиент отмечен на карте');
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Не удалось сохранить');
    },
  });

  const updateBaseMut = useMutation({
    mutationFn: ({ base, latLng, address }: { base: BaseKind; latLng: LatLng | null; address: string | null }) =>
      settingsApi.updateCompanySettings({
        [BASES[base].lat]: latLng?.[0] ?? null,
        [BASES[base].lng]: latLng?.[1] ?? null,
        [BASES[base].address]: address,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['company-settings'], data);
      message.success('Сохранено');
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Не удалось сохранить');
    },
  });

  /** Клик по карте (или по точке клиента) в режиме «указать на карте». */
  const pickPoint = (latlng: L.LatLng): boolean => {
    const p = placingRef.current;
    if (!p) return false;
    setPending({
      placing: p,
      latLng: [round6(latlng.lat), round6(latlng.lng)],
      address: (p.kind === 'base' ? settingsRef.current?.[BASES[p.base].address] : p.client.address) ?? '',
    });
    return true;
  };

  const startPlacing = async (p: Placing) => {
    setPlacing(p);
    setPending(null);
    const map = mapInstance.current;
    const label = p.kind === 'client' ? p.client.companyName : BASES[p.base].title;
    message.info(`Кликните на карте, где находится: ${label}`);
    const address = p.kind === 'client' ? p.client.address : settings?.[BASES[p.base].address];
    // Подлетаем к адресу, если он находится — дальше человек ставит точку сам
    if (map && address?.trim()) {
      const hit = await geocodeAddress(address, 'Uzbekistan').catch(() => null);
      if (hit && placingRef.current === p) map.flyTo(hit, 16);
    }
  };

  const confirmPlacement = () => {
    if (!pending) return;
    const { placing: p, latLng, address } = pending;
    if (p.kind === 'client') {
      updateClientMut.mutate({ id: p.client.id, latLng });
      setSelectedId(p.client.id);
    } else {
      updateBaseMut.mutate({ base: p.base, latLng, address: address.trim() || null });
    }
    setPending(null);
    setPlacing(null);
  };

  // Карта
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return undefined;
    const map = L.map(mapRef.current, { zoomControl: true, preferCanvas: true }).setView(DEFAULT_CENTER, 11);
    L.tileLayer(VED_MAP_TILE_URL, { attribution: VED_MAP_TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    routeLayer.current = L.layerGroup().addTo(map);
    clientsLayer.current = L.layerGroup().addTo(map);
    basesLayer.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    map.on('click', (e: L.LeafletMouseEvent) => pickPoint(e.latlng));

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(mapRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapInstance.current = null;
      clientsLayer.current = null;
      basesLayer.current = null;
      routeLayer.current = null;
    };
  }, []);

  // Один раз показываем всех клиентов и базы
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || fittedRef.current || isLoading || !settings) return;
    const pts: LatLng[] = located.map((c) => [c.latitude, c.longitude]);
    for (const k of ['WAREHOUSE', 'OFFICE'] as BaseKind[]) {
      const b = basePoint(settings, k);
      if (b) pts.push(b);
    }
    fittedRef.current = true;
    if (pts.length === 1) map.setView(pts[0], 14);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
  }, [located, settings, isLoading]);

  // Точки клиентов
  useEffect(() => {
    const layer = clientsLayer.current;
    if (!layer) return;
    layer.clearLayers();
    const visible = new Set(filteredLocated.map((c) => c.id));
    for (const c of located) {
      const inRoute = routeOrder.get(c.id);
      if (!visible.has(c.id) && !inRoute) continue;
      const isSel = c.id === selectedId;
      const tip = `<b>${escapeHtml(c.companyName)}</b>${c.address ? `<br/>${escapeHtml(c.address)}` : ''}`
        + (c.pendingDeliveryDeals ? `<br/>Ждёт доставку: ${c.pendingDeliveryDeals}` : '');
      const marker = inRoute
        ? L.marker([c.latitude, c.longitude], { icon: stopIcon(inRoute, isSel, !!delivered[c.id]), zIndexOffset: 500 })
        : L.circleMarker([c.latitude, c.longitude], {
          radius: isSel ? 10 : 7,
          color: isSel ? '#faad14' : '#fff',
          weight: isSel ? 3 : 2,
          fillColor: c.pendingDeliveryDeals ? COLOR_PENDING : COLOR_CLIENT,
          fillOpacity: 0.95,
        });
      marker.bindTooltip(tip, { direction: 'top', offset: [0, -8] });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        if (!pickPoint(e.latlng)) setSelectedId(c.id);
      });
      marker.addTo(layer);
    }
  }, [located, filteredLocated, routeOrder, selectedId, delivered]);

  // Офис и склад
  useEffect(() => {
    const layer = basesLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const k of ['WAREHOUSE', 'OFFICE'] as BaseKind[]) {
      const p = basePoint(settings, k);
      if (!p) continue;
      const addr = settings?.[BASES[k].address];
      L.marker(p, { icon: baseIcon(k), zIndexOffset: 1000 })
        .bindTooltip(`<b>${BASES[k].title}</b>${addr ? `<br/>${escapeHtml(addr)}` : ''}`, { direction: 'top', offset: [0, -18] })
        .addTo(layer);
    }
  }, [settings]);

  // Дорога по маршруту
  useEffect(() => {
    if (routePoints.length < 2) {
      setRoad(null);
      return undefined;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void fetchRoadRoute(routePoints).then((r) => {
        if (!cancelled) setRoad(r);
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [routePoints]);

  useEffect(() => {
    const layer = routeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (road && road.geometry.length > 1) {
      L.polyline(road.geometry, {
        color: COLOR_ROUTE,
        weight: 5,
        opacity: 0.75,
        dashArray: road.approximate ? '8 8' : undefined,
      }).addTo(layer);
    }
  }, [road]);

  const flyTo = (p: LatLng | null, zoom = 16) => {
    if (p) mapInstance.current?.flyTo(p, Math.max(zoom, mapInstance.current.getZoom()));
  };

  const selectClient = (c: ClientMapPoint) => {
    setSelectedId(c.id);
    if (hasCoords(c)) flyTo([c.latitude, c.longitude]);
  };

  const fitRoute = () => {
    if (routePoints.length) mapInstance.current?.fitBounds(L.latLngBounds(routePoints), { padding: [40, 40] });
  };


  const placingLabel = placing
    ? placing.kind === 'client' ? placing.client.companyName : BASES[placing.base].title
    : '';

  const step = (n: number, title: string, children: ReactNode, hint?: string) => (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--ant-color-split, #f0f0f0)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 11, background: '#1677ff', color: '#fff',
          fontSize: 12, fontWeight: 700, lineHeight: '22px', textAlign: 'center', flex: 'none',
        }}>{n}</span>
        <Typography.Text strong style={{ fontSize: 15 }}>{title}</Typography.Text>
      </div>
      {hint && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '0 0 8px' }}>{hint}</Typography.Paragraph>
      )}
      {children}
    </div>
  );

  const renderBase = (k: BaseKind) => {
    const b = BASES[k];
    const p = basePoint(settings, k);
    const addr = settings?.[b.address];
    return (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span style={{ fontSize: 18 }}>{b.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong>{b.title}</Typography.Text>
          <Typography.Text type={p ? 'secondary' : 'warning'} style={{ display: 'block', fontSize: 12 }} ellipsis>
            {p ? (addr || 'отмечен на карте') : 'не отмечен на карте'}
          </Typography.Text>
        </div>
        {p && <Button size="small" type="link" onClick={() => flyTo(p, 15)}>Показать</Button>}
        {isAdmin && (
          <Button size="small" onClick={() => void startPlacing({ kind: 'base', base: k })}>
            {p ? 'Изменить' : 'Отметить'}
          </Button>
        )}
      </div>
    );
  };

  const saveStatus = !routeReady
    ? <Typography.Text type="secondary">Загрузка маршрута…</Typography.Text>
    : saveRouteMut.isPending
      ? <Typography.Text type="secondary">Сохраняю…</Typography.Text>
      : (
        <Typography.Text type="success">
          <CheckOutlined /> Сохранено — водитель видит этот маршрут у себя
        </Typography.Text>
      );

  const stepStart = step(1, 'Откуда выезжаем', (
    <Space orientation="vertical" size={6} style={{ width: '100%' }}>
      <Segmented
        block
        value={start}
        onChange={(v) => editStart(v as BaseKind)}
        options={[
          { value: 'WAREHOUSE', label: '🏭 Со склада' },
          { value: 'OFFICE', label: '🏢 Из офиса' },
        ]}
      />
      <Checkbox checked={roundtrip} onChange={(e) => editRoundtrip(e.target.checked)}>
        В конце вернуться обратно
      </Checkbox>
      {!startPoint && (
        <Alert
          type="warning"
          showIcon
          title={`${BASES[start].title} ещё не отмечен на карте`}
          description={isAdmin
            ? 'Без него нельзя расставить остановки по пути.'
            : 'Без него нельзя расставить остановки по пути. Попросите администратора отметить.'}
          action={isAdmin && (
            <Button size="small" onClick={() => void startPlacing({ kind: 'base', base: start })}>Отметить</Button>
          )}
        />
      )}
    </Space>
  ));

  const stepWho = step(2, 'Кого везём', (
    <Space orientation="vertical" size={6} style={{ width: '100%' }}>
      <Button
        block
        icon={<PlusOutlined />}
        onClick={addAllPending}
        disabled={pendingNotInRoute === 0}
      >
        {pendingClients.length === 0
          ? 'Заказов на доставку сейчас нет'
          : pendingNotInRoute === 0
            ? 'Все с заказом на доставку уже в маршруте'
            : `Добавить всех с заказом на доставку (${pendingNotInRoute})`}
      </Button>
      <Button block icon={<SearchOutlined />} onClick={() => setTab('clients')}>
        Выбрать клиентов из списка
      </Button>
    </Space>
  ), 'Или нажмите на точку клиента на карте → «Добавить в маршрут».');

  const stepOrder = step(3, `Порядок объезда${routeClients.length ? ` · ${routeClients.length}` : ''}`, (
    routeClients.length === 0 ? (
      <Typography.Text type="secondary">Маршрут пока пуст — добавьте клиентов на шаге 2.</Typography.Text>
    ) : (
      <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        <Button
          type="primary"
          block
          icon={<ThunderboltOutlined />}
          loading={optimizing}
          onClick={() => void optimize()}
          disabled={routeClients.length < 2}
        >
          Расставить по пути (самый короткий объезд)
        </Button>
        {deliveredInRoute > 0 && (
          <Alert
            type="success"
            showIcon
            title={`Водитель отметил доставленными: ${deliveredInRoute}`}
            action={(
              <Button size="small" onClick={() => editRouteIds((prev) => prev.filter((id) => !delivered[id]))}>
                Убрать их
              </Button>
            )}
          />
        )}
        <div>
          {startPoint && (
            <div style={{ padding: '4px 0', color: BASES[start].color }}>
              {BASES[start].emoji} Выезд: {BASES[start].title.toLowerCase()}
            </div>
          )}
          {routeClients.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
                borderTop: '1px solid var(--ant-color-split, #f0f0f0)',
                background: c.id === selectedId ? 'rgba(250,173,20,.12)' : undefined,
              }}
            >
              <span style={{
                minWidth: 22, height: 22, borderRadius: 11, background: delivered[c.id] ? COLOR_DELIVERED : COLOR_ROUTE,
                color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: '22px', textAlign: 'center',
              }}>{delivered[c.id] ? '✓' : i + 1}</span>
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => selectClient(c)}>
                <Typography.Text ellipsis delete={!!delivered[c.id]} style={{ display: 'block' }}>{c.companyName}</Typography.Text>
                {delivered[c.id] ? (
                  <Typography.Text type="success" ellipsis style={{ display: 'block', fontSize: 12 }}>
                    Доставлено {formatTime(delivered[c.id].at)}{delivered[c.id].byName ? ` · ${delivered[c.id].byName}` : ''}
                  </Typography.Text>
                ) : c.address && (
                  <Typography.Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
                    {c.address}
                  </Typography.Text>
                )}
              </div>
              <Tooltip title="Раньше">
                <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => moveStop(c.id, -1)} />
              </Tooltip>
              <Tooltip title="Позже">
                <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === routeClients.length - 1} onClick={() => moveStop(c.id, 1)} />
              </Tooltip>
              <Tooltip title="Убрать из маршрута">
                <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={() => toggleInRoute(c.id)} />
              </Tooltip>
            </div>
          ))}
          {startPoint && roundtrip && (
            <div style={{ padding: '4px 0', color: BASES[start].color, borderTop: '1px solid var(--ant-color-split, #f0f0f0)' }}>
              {BASES[start].emoji} Возврат: {BASES[start].title.toLowerCase()}
            </div>
          )}
        </div>
        <Button
          size="small"
          type="link"
          danger
          icon={<DeleteOutlined />}
          style={{ paddingInline: 0 }}
          onClick={() => Modal.confirm({
            title: 'Очистить весь маршрут?',
            content: 'Водитель тоже перестанет его видеть.',
            okText: 'Очистить',
            okButtonProps: { danger: true },
            cancelText: 'Отмена',
            onOk: () => editRouteIds([]),
          })}
        >
          Очистить весь маршрут
        </Button>
      </Space>
    )
  ));

  const summary = (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--ant-color-split, #f0f0f0)' }}>
      {road && routeClients.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <Typography.Text style={{ fontSize: 16 }}>
            <b>{road.distanceKm.toFixed(1)} км</b> · ≈ {formatDuration(road.durationMin)} в пути
          </Typography.Text>
          {road.approximate && <Tag color="orange" style={{ marginLeft: 8 }}>по прямой</Tag>}
        </div>
      )}
      <div style={{ marginBottom: 8, fontSize: 13 }}>{saveStatus}</div>
      {road && routeClients.length > 0 && (
        <Space wrap size={6}>
          <Button type="primary" icon={<EnvironmentOutlined />} href={yandexRouteUrl(routePoints)} target="_blank">
            Открыть в Яндекс Картах
          </Button>
          <Button icon={<AimOutlined />} onClick={fitRoute}>Показать на карте</Button>
        </Space>
      )}
    </div>
  );

  const clientRow = (c: ClientMapPoint) => {
    const onMap = hasCoords(c);
    const inRoute = routeOrder.has(c.id);
    return (
      <div
        key={c.id}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
          borderTop: '1px solid var(--ant-color-split, #f0f0f0)',
          background: c.id === selectedId ? 'rgba(250,173,20,.12)' : undefined,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => selectClient(c)}>
          <Typography.Text ellipsis style={{ display: 'block' }}>{c.companyName}</Typography.Text>
          <Typography.Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
            {c.address || 'адрес не указан'}
          </Typography.Text>
          {c.pendingDeliveryDeals > 0 && (
            <Tag color="orange" style={{ marginTop: 2 }}>заказ на доставку: {c.pendingDeliveryDeals}</Tag>
          )}
        </div>
        {onMap ? (
          inRoute ? (
            <Button size="small" onClick={() => toggleInRoute(c.id)}>
              ✓ №{routeOrder.get(c.id)} · убрать
            </Button>
          ) : (
            <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => toggleInRoute(c.id)}>
              Добавить
            </Button>
          )
        ) : canEditClient ? (
          <Button size="small" onClick={() => void startPlacing({ kind: 'client', client: c })}>Отметить на карте</Button>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>нет точки</Typography.Text>
        )}
      </div>
    );
  };

  const LIST_LIMIT = 300;
  const clientsPicker = (
    <Space orientation="vertical" style={{ width: '100%' }} size={8}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => setTab('route')}>
        Готово — к маршруту ({routeClients.length})
      </Button>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Поиск: название, адрес, телефон"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Checkbox checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)}>
        Только с заказом на доставку
      </Checkbox>
      <div>
        {filteredLocated.slice(0, LIST_LIMIT).map(clientRow)}
        {filteredLocated.length > LIST_LIMIT && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Показаны первые {LIST_LIMIT} из {filteredLocated.length} — уточните поиск
          </Typography.Text>
        )}
        {filteredLocated.length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Никого не найдено" />
        )}
      </div>
      {filteredUnlocated.length > 0 && (
        <Collapse
          size="small"
          items={[{
            key: 'unlocated',
            label: `Нет точки на карте — нельзя добавить: ${filteredUnlocated.length}`,
            children: (
              <div>
                {canEditClient && (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    Нажмите «Отметить на карте», затем кликните место клиента на карте.
                  </Typography.Paragraph>
                )}
                {filteredUnlocated.slice(0, LIST_LIMIT).map(clientRow)}
              </div>
            ),
          }]}
        />
      )}
    </Space>
  );

  const selectedCard = selected && (
    <Card
      size="small"
      style={{ borderColor: '#faad14', marginBottom: 8 }}
      title={<Typography.Text ellipsis>{selected.companyName}</Typography.Text>}
      extra={<Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setSelectedId(null)} />}
    >
      <div style={{ fontSize: 13 }}>
        <div>{selected.contactName}{selected.phone ? ` · ${selected.phone}` : ''}</div>
        {selected.address && <div style={{ color: 'var(--ant-color-text-secondary, #8c8c8c)' }}>{selected.address}</div>}
        <div>Менеджер: {selected.manager.fullName}</div>
        {selected.pendingDeliveryDeals > 0 && (
          <Tag color="orange" style={{ marginTop: 4 }}>заказ на доставку: {selected.pendingDeliveryDeals}</Tag>
        )}
      </div>
      <Space wrap size={6} style={{ marginTop: 8 }}>
        {hasCoords(selected) && (
          routeOrder.has(selected.id) ? (
            <Button onClick={() => toggleInRoute(selected.id)}>
              Убрать из маршрута (№{routeOrder.get(selected.id)})
            </Button>
          ) : (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => toggleInRoute(selected.id)}>
              Добавить в маршрут
            </Button>
          )
        )}
        <Link to={`/clients/${selected.id}`}><Button>Карточка клиента</Button></Link>
        {canEditClient && (
          <Button type="link" onClick={() => void startPlacing({ kind: 'client', client: selected })}>
            {hasCoords(selected) ? 'Поправить точку' : 'Отметить на карте'}
          </Button>
        )}
      </Space>
    </Card>
  );

  const basesBlock = (
    <Collapse
      size="small"
      style={{ marginTop: 8 }}
      defaultActiveKey={startPoint ? [] : ['bases']}
      items={[{
        key: 'bases',
        label: 'Склад и офис на карте',
        children: (
          <div>
            {renderBase('WAREHOUSE')}
            {renderBase('OFFICE')}
          </div>
        ),
      }]}
    />
  );

  return (
    <div style={isMobile
      ? { display: 'flex', flexDirection: 'column' }
      : { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 520 }}
    >
      <div style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Маршрут доставки</Typography.Title>
        <Typography.Text type="secondary">
          Соберите, кого везти, — программа расставит их по пути, а водитель увидит маршрут у себя в телефоне.
        </Typography.Text>
      </div>
      {placing && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={<>Кликните на карте, где находится: <b>{placingLabel}</b></>}
          action={<Button size="small" onClick={() => { setPlacing(null); setPending(null); }}>Отмена</Button>}
        />
      )}

      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
        <Card
          size="small"
          style={isMobile
            ? { width: '100%' }
            : { width: 400, display: 'flex', flexDirection: 'column', maxHeight: '100%' }}
          styles={{ body: { overflowY: 'auto', flex: 1, minHeight: 0 } }}
        >
          {selectedCard}
          {tab === 'clients' ? clientsPicker : (
            <>
              {stepStart}
              {stepWho}
              {stepOrder}
              {summary}
              {basesBlock}
            </>
          )}
        </Card>

        <Card
          size="small"
          style={isMobile
            ? { width: '100%', height: '55vh', order: -1, position: 'relative' }
            : { flex: 1, minWidth: 300, minHeight: 420, position: 'relative' }}
          styles={{ body: { padding: 0, height: '100%' } }}
        >
          <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: isMobile ? 0 : 420, borderRadius: 8 }} />
          <div style={{
            position: 'absolute', right: 10, top: 10, zIndex: 500, background: 'rgba(255,255,255,.94)',
            borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#333', boxShadow: '0 1px 4px rgba(0,0,0,.2)',
            lineHeight: 1.7,
          }}>
            <div><span style={{ color: COLOR_CLIENT }}>●</span> клиент</div>
            <div><span style={{ color: COLOR_PENDING }}>●</span> есть заказ на доставку</div>
            <div><span style={{ color: COLOR_ROUTE }}>●</span> в маршруте (цифра — порядок)</div>
            <div><span style={{ color: COLOR_DELIVERED }}>●</span> уже доставлено</div>
          </div>
        </Card>
      </div>

      <Modal
        open={!!pending}
        title={pending?.placing.kind === 'base'
          ? `${BASES[pending.placing.base].emoji} ${BASES[pending.placing.base].title} — сохранить точку здесь?`
          : `Отметить «${pending?.placing.kind === 'client' ? pending.placing.client.companyName : ''}» здесь?`}
        okText="Сохранить"
        cancelText="Выбрать другое место"
        onOk={confirmPlacement}
        onCancel={() => setPending(null)}
        confirmLoading={updateClientMut.isPending || updateBaseMut.isPending}
      >
        {pending && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              Координаты: {pending.latLng[0]}, {pending.latLng[1]}
            </Typography.Text>
            {pending.placing.kind === 'base' && (
              <Input
                placeholder="Адрес или подпись (необязательно)"
                value={pending.address}
                onChange={(e) => setPending({ ...pending, address: e.target.value })}
              />
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}
