import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Checkbox,
  ColorPicker,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  NodeIndexOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import VedMapRoutePointsEditor from '../components/VedMapRoutePointsEditor';
import { VED_MAP_COUNTRY_OPTIONS, displayCountryEnglish } from '../constants/vedMapCountries';
import {
  VED_MAP_TILE_ATTRIBUTION,
  VED_MAP_TILE_URL,
  fetchRouteGeometry,
  geocodeAddress,
  pathDistanceKm,
  type LatLng,
} from '../lib/vedMapGeo';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { vedMapApi } from '../api/ved-map.api';
import { suppliersApi } from '../api/suppliers.api';
import { uploadsUrl } from '../lib/uploadsUrl';
import { useAuthStore } from '../store/authStore';
import type {
  SupplierSite,
  SupplierSitePayload,
  SupplierSiteType,
  VedMapRoute,
  VedMapRoutePointPayload,
} from '../types';
import {
  SUPPLIER_SITE_TYPE_LABELS,
  SUPPLIER_SITE_TYPES,
} from '../types';

const SITE_TYPE_COLORS: Record<SupplierSiteType, string> = {
  FACTORY: '#22609A',
  WAREHOUSE: '#52c41a',
  PORT: '#1677ff',
  OFFICE: '#722ed1',
  OTHER: '#8c8c8c',
};

function makeSiteIcon(
  site: SupplierSite,
  selected: boolean,
  routeOrder: number | null,
): L.DivIcon {
  const logo = uploadsUrl(site.supplier.logoPath);
  const color = SITE_TYPE_COLORS[site.siteType];
  const size = selected || routeOrder != null ? 40 : 32;
  const inner = logo
    ? `<img src="${logo}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:4px;" />`
    : `<span style="font-size:11px;font-weight:700;color:${color};">${site.name.slice(0, 2).toUpperCase()}</span>`;
  const badge = routeOrder != null
    ? `<span style="
        position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;
        padding:0 4px;border-radius:8px;background:#1677ff;color:#fff;
        font-size:10px;font-weight:700;line-height:16px;text-align:center;
      ">${routeOrder}</span>`
    : '';

  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px;">
      <div style="
        width:${size}px;height:${size}px;
        border:3px solid ${selected ? '#faad14' : routeOrder != null ? '#1677ff' : color};
        border-radius:8px;
        background:#fff;
        box-shadow:0 2px 8px rgba(0,0,0,.25);
        display:flex;align-items:center;justify-content:center;
        overflow:hidden;
      ">${inner}</div>${badge}</div>`,
  });
}

export default function VedMapPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterSupplierId = searchParams.get('supplierId') ?? undefined;

  const user = useAuthStore((s) => s.user);
  const canManage =
    user?.role === 'SUPER_ADMIN'
    || user?.role === 'ADMIN'
    || (user?.permissions ?? []).includes('manage_suppliers');

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const routesLayer = useRef<L.LayerGroup | null>(null);
  const draftPlaceLayer = useRef<L.LayerGroup | null>(null);
  const buildRouteOnMapRef = useRef(false);
  const mapClickModeRef = useRef<'none' | 'place-site' | 'build-route'>('none');

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [visibleRouteIds, setVisibleRouteIds] = useState<string[]>([]);
  const [placeSiteOnMap, setPlaceSiteOnMap] = useState(false);
  const [buildRouteOnMap, setBuildRouteOnMap] = useState(false);
  const [draftPlaceLatLng, setDraftPlaceLatLng] = useState<LatLng | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [routeGeometries, setRouteGeometries] = useState<Record<string, LatLng[]>>({});
  const [draftGeometry, setDraftGeometry] = useState<LatLng[]>([]);
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<SupplierSite | null>(null);
  const [editingRoute, setEditingRoute] = useState<VedMapRoute | null>(null);
  const [routePointIds, setRoutePointIds] = useState<string[]>([]);
  const [siteForm] = Form.useForm<SupplierSitePayload>();
  const [routeForm] = Form.useForm<{ name: string; supplierId?: string; color?: string; notes?: string }>();

  const { data: sites = [], isLoading: sitesLoading } = useQuery({
    queryKey: ['ved-map-sites', filterSupplierId],
    queryFn: () => vedMapApi.listSites({ supplierId: filterSupplierId }),
  });

  const { data: routes = [] } = useQuery({
    queryKey: ['ved-map-routes', filterSupplierId],
    queryFn: () => vedMapApi.listRoutes({ supplierId: filterSupplierId }),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-map'],
    queryFn: () => suppliersApi.list(),
  });

  const supplierOptions = useMemo(
    () => suppliers.filter((s) => !s.isArchived).map((s) => ({ value: s.id, label: s.companyName })),
    [suppliers],
  );

  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? null;

  const routeOrderBySiteId = useMemo(() => {
    const map = new Map<string, number>();
    routePointIds.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [routePointIds]);

  const draftWaypoints = useMemo(
    () => routePointIds
      .map((id) => sites.find((s) => s.id === id))
      .filter((s): s is SupplierSite => !!s)
      .map((s) => [s.latitude, s.longitude] as LatLng),
    [routePointIds, sites],
  );

  const draftDistanceKm = useMemo(() => pathDistanceKm(draftWaypoints), [draftWaypoints]);

  useEffect(() => {
    buildRouteOnMapRef.current = buildRouteOnMap;
    mapClickModeRef.current = placeSiteOnMap
      ? 'place-site'
      : buildRouteOnMap
        ? 'build-route'
        : 'none';
  }, [buildRouteOnMap, placeSiteOnMap]);

  const applyPlacedCoordinates = useCallback((lat: number, lng: number) => {
    const latitude = Math.round(lat * 1e6) / 1e6;
    const longitude = Math.round(lng * 1e6) / 1e6;
    siteForm.setFieldsValue({ latitude, longitude });
    setDraftPlaceLatLng([latitude, longitude]);
    setPlaceSiteOnMap(false);
    setSiteModalOpen(true);
    message.success('Метка на карте установлена — заполните данные и сохраните');
  }, [siteForm]);

  useEffect(() => {
    if (draftWaypoints.length < 2) {
      setDraftGeometry([]);
      return undefined;
    }
    let cancelled = false;
    fetchRouteGeometry(draftWaypoints).then((geom) => {
      if (!cancelled) setDraftGeometry(geom);
    });
    return () => {
      cancelled = true;
    };
  }, [draftWaypoints]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next: Record<string, LatLng[]> = {};
      for (const route of routes) {
        if (!visibleRouteIds.includes(route.id)) continue;
        const wps = route.points.map((p) => [p.latitude, p.longitude] as LatLng);
        if (wps.length < 2) continue;
        next[route.id] = await fetchRouteGeometry(wps);
      }
      if (!cancelled) setRouteGeometries(next);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [routes, visibleRouteIds]);

  useEffect(() => {
    if (!routeModalOpen || editingRoute || routePointIds.length < 2) return;
    const labels = routePointIds
      .map((id) => sites.find((s) => s.id === id)?.name)
      .filter((n): n is string => !!n);
    if (labels.length >= 2) {
      routeForm.setFieldValue('name', labels.join(' → '));
    }
  }, [routePointIds, routeModalOpen, editingRoute, sites, routeForm]);

  const createSiteMut = useMutation({
    mutationFn: (payload: SupplierSitePayload) => vedMapApi.createSite(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ved-map-sites'] });
      message.success('Точка добавлена');
      setSiteModalOpen(false);
      setPlaceSiteOnMap(false);
      setDraftPlaceLatLng(null);
      siteForm.resetFields();
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const updateSiteMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SupplierSitePayload> }) =>
      vedMapApi.updateSite(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ved-map-sites'] });
      message.success('Точка обновлена');
      setSiteModalOpen(false);
      setEditingSite(null);
      setPlaceSiteOnMap(false);
      setDraftPlaceLatLng(null);
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const deleteSiteMut = useMutation({
    mutationFn: (id: string) => vedMapApi.deleteSite(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ved-map-sites'] });
      setSelectedSiteId(null);
      message.success('Точка удалена');
    },
  });

  const createRouteMut = useMutation({
    mutationFn: vedMapApi.createRoute,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ved-map-routes'] });
      message.success('Маршрут сохранён');
      setRouteModalOpen(false);
      setBuildRouteOnMap(false);
      routeForm.resetFields();
      setRoutePointIds([]);
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const updateRouteMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof vedMapApi.updateRoute>[1] }) =>
      vedMapApi.updateRoute(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ved-map-routes'] });
      message.success('Маршрут обновлён');
      setRouteModalOpen(false);
      setBuildRouteOnMap(false);
      setEditingRoute(null);
      setRoutePointIds([]);
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const deleteRouteMut = useMutation({
    mutationFn: (id: string) => vedMapApi.deleteRoute(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ved-map-routes'] });
      message.success('Маршрут удалён');
    },
  });

  const startPlaceSiteOnMap = () => {
    setEditingSite(null);
    setBuildRouteOnMap(false);
    setRouteModalOpen(false);
    setDraftPlaceLatLng(null);
    siteForm.resetFields();
    siteForm.setFieldsValue({
      supplierId: filterSupplierId,
      siteType: 'FACTORY',
    });
    setPlaceSiteOnMap(true);
    setSiteModalOpen(false);
    message.info('Кликните на карте в нужном месте — появится метка');
  };

  const openCreateSiteForm = () => {
    setEditingSite(null);
    siteForm.resetFields();
    siteForm.setFieldsValue({
      supplierId: filterSupplierId,
      siteType: 'FACTORY',
      latitude: 31.23,
      longitude: 121.47,
    });
    setPlaceSiteOnMap(false);
    setSiteModalOpen(true);
  };

  const openEditSite = (site: SupplierSite) => {
    setEditingSite(site);
    siteForm.setFieldsValue({
      supplierId: site.supplierId,
      name: site.name,
      siteType: site.siteType,
      address: site.address,
      country: site.country,
      latitude: site.latitude,
      longitude: site.longitude,
      notes: site.notes,
    });
    setSiteModalOpen(true);
  };

  const openCreateRoute = () => {
    setEditingRoute(null);
    setRoutePointIds([]);
    setBuildRouteOnMap(true);
    setPlaceSiteOnMap(false);
    routeForm.resetFields();
    routeForm.setFieldsValue({
      supplierId: filterSupplierId,
      color: '#22609A',
    });
    setRouteModalOpen(true);
  };

  const openEditRoute = (route: VedMapRoute) => {
    setEditingRoute(route);
    setBuildRouteOnMap(true);
    setPlaceSiteOnMap(false);
    setRoutePointIds(route.points.map((p) => p.siteId).filter((id): id is string => !!id));
    routeForm.setFieldsValue({
      name: route.name,
      supplierId: route.supplierId ?? undefined,
      color: route.color ?? '#22609A',
      notes: route.notes ?? undefined,
    });
    setRouteModalOpen(true);
  };

  const buildRoutePoints = useCallback((): VedMapRoutePointPayload[] => {
    return routePointIds
      .map((siteId) => sites.find((s) => s.id === siteId))
      .filter((s): s is SupplierSite => !!s)
      .map((s) => ({
        siteId: s.id,
        label: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
      }));
  }, [routePointIds, sites]);

  const saveRoute = async () => {
    const values = await routeForm.validateFields();
    const points = buildRoutePoints();
    if (points.length < 2) {
      message.warning('Выберите минимум 2 точки для маршрута');
      return;
    }
    let color = '#22609A';
    const rawColor = values.color;
    if (typeof rawColor === 'string') {
      color = rawColor;
    } else if (rawColor && typeof rawColor === 'object' && 'toHexString' in rawColor) {
      color = (rawColor as { toHexString: () => string }).toHexString();
    }

    const payload = {
      name: values.name,
      supplierId: values.supplierId ?? null,
      color,
      notes: values.notes ?? null,
      points,
    };
    if (editingRoute) {
      updateRouteMut.mutate({ id: editingRoute.id, data: payload });
    } else {
      createRouteMut.mutate(payload);
    }
  };

  const saveSite = async () => {
    const values = await siteForm.validateFields();
    if (editingSite) {
      updateSiteMut.mutate({ id: editingSite.id, data: values });
    } else {
      createSiteMut.mutate(values);
    }
  };

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, { zoomControl: true }).setView([30, 50], 3);
    L.tileLayer(VED_MAP_TILE_URL, {
      attribution: VED_MAP_TILE_ATTRIBUTION,
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    markersLayer.current = L.layerGroup().addTo(map);
    routesLayer.current = L.layerGroup().addTo(map);
    draftPlaceLayer.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    const t1 = window.setTimeout(() => map.invalidateSize(), 0);
    const t2 = window.setTimeout(() => map.invalidateSize(), 350);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      map.remove();
      mapInstance.current = null;
      markersLayer.current = null;
      routesLayer.current = null;
      draftPlaceLayer.current = null;
    };
  }, []);

  useEffect(() => {
    const el = mapRef.current;
    const map = mapInstance.current;
    if (!el || !map) return undefined;

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Map clicks: place new site marker or build route
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (mapClickModeRef.current === 'place-site') {
        applyPlacedCoordinates(e.latlng.lat, e.latlng.lng);
      }
    };

    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [applyPlacedCoordinates]);

  // Draft pin for coordinates picked on map
  useEffect(() => {
    const layer = draftPlaceLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!draftPlaceLatLng) return;

    const marker = L.marker(draftPlaceLatLng, {
      icon: L.divIcon({
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: '<div style="width:20px;height:20px;border-radius:50%;background:#fa541c;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);"></div>',
      }),
      zIndexOffset: 1000,
    });
    layer.addLayer(marker);
  }, [draftPlaceLatLng]);

  // Draw markers
  useEffect(() => {
    const layer = markersLayer.current;
    const map = mapInstance.current;
    if (!layer || !map) return;

    layer.clearLayers();
    for (const site of sites) {
      const routeOrder = routeOrderBySiteId.get(site.id) ?? null;
      const marker = L.marker([site.latitude, site.longitude], {
        icon: makeSiteIcon(site, site.id === selectedSiteId, routeOrder),
      });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedSiteId(site.id);
        if (mapClickModeRef.current === 'place-site') {
          applyPlacedCoordinates(site.latitude, site.longitude);
          return;
        }
        if (buildRouteOnMapRef.current) {
          setRoutePointIds((prev) => (
            prev.includes(site.id) ? prev : [...prev, site.id]
          ));
        }
      });
      const countryEn = displayCountryEnglish(site.country);
      marker.bindPopup(
        `<strong>${site.name}</strong><br/>
        ${SUPPLIER_SITE_TYPE_LABELS[site.siteType]}<br/>
        ${site.supplier.companyName}${countryEn ? ` · ${countryEn}` : ''}`,
      );
      layer.addLayer(marker);
    }

    if (selectedSite) {
      map.flyTo([selectedSite.latitude, selectedSite.longitude], 8, { duration: 0.6 });
    }
  }, [sites, selectedSiteId, selectedSite, routeOrderBySiteId, applyPlacedCoordinates]);

  // Draw routes
  useEffect(() => {
    const layer = routesLayer.current;
    if (!layer) return;
    layer.clearLayers();

    for (const route of routes) {
      if (!visibleRouteIds.includes(route.id)) continue;
      const waypoints = route.points.map((p) => [p.latitude, p.longitude] as LatLng);
      if (waypoints.length < 2) continue;
      const latlngs = routeGeometries[route.id] ?? waypoints;
      const km = pathDistanceKm(waypoints);
      const polyline = L.polyline(latlngs, {
        color: route.color ?? '#22609A',
        weight: 4,
        opacity: 0.9,
      });
      polyline.bindPopup(
        `<strong>${route.name}</strong><br/>${route.points.length} stops · ~${km.toFixed(0)} km (direct)`,
      );
      layer.addLayer(polyline);
    }

    if (draftGeometry.length >= 2) {
      const draftLine = L.polyline(draftGeometry, {
        color: '#fa8c16',
        weight: 4,
        opacity: 0.95,
        dashArray: '6 4',
      });
      draftLine.bindPopup(
        `Draft route · ${routePointIds.length} stops · ~${draftDistanceKm.toFixed(0)} km (direct)`,
      );
      layer.addLayer(draftLine);
    }
  }, [routes, visibleRouteIds, routeGeometries, draftGeometry, routePointIds.length, draftDistanceKm]);

  // Auto-show all routes when loaded first time
  useEffect(() => {
    if (routes.length > 0 && visibleRouteIds.length === 0) {
      setVisibleRouteIds(routes.map((r) => r.id));
    }
  }, [routes, visibleRouteIds.length]);

  const openYandexRoute = (route: VedMapRoute) => {
    const pts = route.points;
    if (pts.length < 2) return;
    const rtext = pts.map((p) => `${p.latitude},${p.longitude}`).join('~');
    window.open(`https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`, '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 480 }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Карта ВЭД
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Подписи на карте и страны — на английском · маршрут строится по дорогам между точками
          </Typography.Text>
        </div>
        {filterSupplierId && (
          <Tag closable onClose={() => navigate('/foreign-trade/map')}>
            Фильтр по поставщику
          </Tag>
        )}
        {canManage && (
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={startPlaceSiteOnMap}>
              Поставить точку
            </Button>
            <Button icon={<EditOutlined />} onClick={openCreateSiteForm}>
              Точка вручную
            </Button>
            <Button icon={<NodeIndexOutlined />} onClick={openCreateRoute}>
              Построить маршрут
            </Button>
            {placeSiteOnMap && (
              <Button
                onClick={() => {
                  setPlaceSiteOnMap(false);
                  setDraftPlaceLatLng(null);
                }}
              >
                Отмена метки
              </Button>
            )}
            {buildRouteOnMap && (
              <Button
                onClick={() => {
                  setBuildRouteOnMap(false);
                  setRoutePointIds([]);
                  setRouteModalOpen(false);
                }}
              >
                Отмена маршрута
              </Button>
            )}
          </>
        )}
      </Space>

      <div style={{ display: 'flex', flex: 1, gap: 12, minHeight: 0 }}>
        <Card
          size="small"
          style={{ width: 340, flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{ padding: 0, flex: 1, overflow: 'auto' }}
        >
          <Tabs
            size="small"
            style={{ padding: '0 8px' }}
            items={[
              {
                key: 'sites',
                label: `Точки (${sites.length})`,
                children: (
                  <List
                    size="small"
                    loading={sitesLoading}
                    dataSource={sites}
                    locale={{ emptyText: 'Нет точек на карте' }}
                    renderItem={(site) => (
                      <List.Item
                        style={{
                          cursor: 'pointer',
                          background: site.id === selectedSiteId ? 'rgba(34,96,154,0.08)' : undefined,
                          padding: '8px 12px',
                        }}
                        onClick={() => setSelectedSiteId(site.id)}
                        actions={canManage ? [
                          <Button key="e" type="text" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openEditSite(site); }} />,
                          <Button key="d" type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => {
                            e.stopPropagation();
                            Modal.confirm({
                              title: 'Удалить точку?',
                              onOk: () => deleteSiteMut.mutate(site.id),
                            });
                          }} />,
                        ] : undefined}
                      >
                        <List.Item.Meta
                          title={(
                            <Space size={4}>
                              <Tag color={SITE_TYPE_COLORS[site.siteType]} style={{ margin: 0 }}>
                                {SUPPLIER_SITE_TYPE_LABELS[site.siteType]}
                              </Tag>
                              <span>{site.name}</span>
                            </Space>
                          )}
                          description={(
                            <span onClick={(e) => e.stopPropagation()} role="presentation">
                              <Link to={`/foreign-trade/suppliers/${site.supplierId}`}>
                                {site.supplier.companyName}
                              </Link>
                              {site.country && (
                                <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                                  {displayCountryEnglish(site.country)}
                                </Typography.Text>
                              )}
                            </span>
                          )}
                        />
                      </List.Item>
                    )}
                  />
                ),
              },
              {
                key: 'routes',
                label: `Маршруты (${routes.length})`,
                children: (
                  <List
                    size="small"
                    dataSource={routes}
                    locale={{ emptyText: 'Нет маршрутов' }}
                    renderItem={(route) => (
                      <List.Item
                        style={{ padding: '8px 12px' }}
                        actions={[
                          <Checkbox
                            key="v"
                            checked={visibleRouteIds.includes(route.id)}
                            onChange={(e) => {
                              setVisibleRouteIds((prev) =>
                                e.target.checked
                                  ? [...prev, route.id]
                                  : prev.filter((id) => id !== route.id),
                              );
                            }}
                          />,
                          ...(canManage ? [
                            <Button key="e" type="text" size="small" icon={<EditOutlined />} onClick={() => openEditRoute(route)} />,
                            <Button key="d" type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => {
                              Modal.confirm({
                                title: 'Удалить маршрут?',
                                onOk: () => deleteRouteMut.mutate(route.id),
                              });
                            }} />,
                          ] : []),
                        ]}
                      >
                        <List.Item.Meta
                          title={(
                            <Space>
                              <span style={{
                                display: 'inline-block', width: 10, height: 10,
                                borderRadius: 2, background: route.color ?? '#22609A',
                              }} />
                              {route.name}
                            </Space>
                          )}
                          description={`${route.points.length} точек`}
                        />
                        <Button type="link" size="small" icon={<EnvironmentOutlined />} onClick={() => openYandexRoute(route)}>
                          Яндекс
                        </Button>
                      </List.Item>
                    )}
                  />
                ),
              },
            ]}
          />
        </Card>

        <Card
          size="small"
          style={{ flex: 1, minWidth: 0, position: 'relative' }}
          bodyStyle={{ padding: 0, height: '100%' }}
        >
          <div
            ref={mapRef}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 400,
              borderRadius: 8,
              cursor: placeSiteOnMap ? 'crosshair' : undefined,
            }}
          />
          {placeSiteOnMap && (
            <Card
              size="small"
              style={{
                position: 'absolute', top: 12, left: 12, right: 12, maxWidth: 520, zIndex: 1000,
                pointerEvents: 'none',
              }}
            >
              <Typography.Text>
                <strong>Кликните на карте</strong> — здесь появится новая метка (завод, порт…).
              </Typography.Text>
            </Card>
          )}
          {buildRouteOnMap && !placeSiteOnMap && (
            <Card
              size="small"
              style={{
                position: 'absolute', top: 12, left: 12, right: 12, maxWidth: 520, zIndex: 1000,
                pointerEvents: 'none',
              }}
            >
              <Typography.Text>
                <strong>Режим маршрута:</strong> кликайте существующие метки на карте по порядку
                {routePointIds.length > 0 ? ` (${routePointIds.length})` : ''}.
                {draftDistanceKm > 0 && ` ~${draftDistanceKm.toFixed(0)} km между остановками.`}
              </Typography.Text>
            </Card>
          )}
          {selectedSite && (
            <Card
              size="small"
              style={{
                position: 'absolute', bottom: 12, left: 12, right: 12, maxWidth: 420, zIndex: 1000,
              }}
            >
              <Space direction="vertical" size={4}>
                <Typography.Text strong>{selectedSite.name}</Typography.Text>
                <Typography.Text type="secondary">
                  {SUPPLIER_SITE_TYPE_LABELS[selectedSite.siteType]} · {selectedSite.supplier.companyName}
                </Typography.Text>
                {selectedSite.country && (
                  <Typography.Text>{displayCountryEnglish(selectedSite.country)}</Typography.Text>
                )}
                {selectedSite.address && <Typography.Text>{selectedSite.address}</Typography.Text>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {selectedSite.latitude.toFixed(5)}, {selectedSite.longitude.toFixed(5)}
                </Typography.Text>
                {canManage && buildRouteOnMap && !routePointIds.includes(selectedSite.id) && (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => setRoutePointIds((prev) => [...prev, selectedSite.id])}
                  >
                    Добавить в маршрут
                  </Button>
                )}
              </Space>
            </Card>
          )}
        </Card>
      </div>

      <Modal
        title={editingSite ? 'Редактировать точку' : 'Новая точка на карте'}
        open={siteModalOpen}
        onCancel={() => {
          setSiteModalOpen(false);
          setPlaceSiteOnMap(false);
          setDraftPlaceLatLng(null);
          setEditingSite(null);
        }}
        onOk={saveSite}
        confirmLoading={createSiteMut.isPending || updateSiteMut.isPending}
        okText="Сохранить"
        width={520}
      >
        <Form form={siteForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="supplierId" label="Поставщик" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={supplierOptions} placeholder="Выберите поставщика" />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Завод Шанхай №1" />
          </Form.Item>
          <Form.Item name="siteType" label="Тип">
            <Select options={SUPPLIER_SITE_TYPES.map((t) => ({ value: t, label: SUPPLIER_SITE_TYPE_LABELS[t] }))} />
          </Form.Item>
          <Form.Item name="address" label="Адрес">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="country" label="Country (English)">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="e.g. China"
              options={VED_MAP_COUNTRY_OPTIONS}
            />
          </Form.Item>
          <Space align="start" style={{ width: '100%' }} wrap>
            <Form.Item name="latitude" label="Широта" rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <Input type="number" step="any" />
            </Form.Item>
            <Form.Item name="longitude" label="Долгота" rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <Input type="number" step="any" />
            </Form.Item>
          </Space>
          {canManage && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                type="primary"
                icon={<EnvironmentOutlined />}
                onClick={() => {
                  setBuildRouteOnMap(false);
                  setRouteModalOpen(false);
                  setPlaceSiteOnMap(true);
                  setSiteModalOpen(false);
                  message.info('Кликните на карте, чтобы изменить положение метки');
                }}
                block
              >
                Указать на карте кликом
              </Button>
              <Button
                loading={geocoding}
                icon={<EnvironmentOutlined />}
                onClick={async () => {
                  const { address, country } = siteForm.getFieldsValue();
                  if (!address?.trim()) {
                    message.warning('Введите адрес');
                    return;
                  }
                  setGeocoding(true);
                  try {
                    const ll = await geocodeAddress(address, country);
                    if (!ll) {
                      message.warning('Адрес не найден (попробуйте на английском)');
                      return;
                    }
                    siteForm.setFieldsValue({
                      latitude: Math.round(ll[0] * 1e6) / 1e6,
                      longitude: Math.round(ll[1] * 1e6) / 1e6,
                    });
                    message.success('Координаты найдены');
                  } finally {
                    setGeocoding(false);
                  }
                }}
                block
              >
                Найти по адресу (English map)
              </Button>
            </Space>
          )}
          <Form.Item name="notes" label="Заметки" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingRoute ? 'Редактировать маршрут' : 'Новый маршрут'}
        open={routeModalOpen}
        mask={!buildRouteOnMap}
        onCancel={() => {
          setRouteModalOpen(false);
          setEditingRoute(null);
          setRoutePointIds([]);
          setBuildRouteOnMap(false);
        }}
        onOk={saveRoute}
        confirmLoading={createRouteMut.isPending || updateRouteMut.isPending}
        okText="Сохранить"
        width={520}
      >
        <Form form={routeForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Название маршрута" rules={[{ required: true }]}>
            <Input placeholder="Шанхай → порт Нинбо → Ташкент" />
          </Form.Item>
          <Form.Item name="supplierId" label="Поставщик (опционально)">
            <Select allowClear showSearch optionFilterProp="label" options={supplierOptions} />
          </Form.Item>
          <Form.Item name="color" label="Цвет линии">
            <ColorPicker showText format="hex" />
          </Form.Item>
          <Form.Item
            label={`Точки маршрута (${routePointIds.length})`}
            extra="Кликайте маркеры на карте или меняйте порядок стрелками. Линия — по дорогам (OSRM)."
          >
            <VedMapRoutePointsEditor
              siteIds={routePointIds}
              sites={sites}
              onChange={setRoutePointIds}
            />
          </Form.Item>
          <Button
            type={buildRouteOnMap ? 'primary' : 'dashed'}
            icon={<NodeIndexOutlined />}
            onClick={() => {
              setBuildRouteOnMap((v) => !v);
              if (!buildRouteOnMap) setPlaceSiteOnMap(false);
            }}
            block
          >
            {buildRouteOnMap ? 'Сбор на карте включён' : 'Собирать маршрут кликом по карте'}
          </Button>
          <Form.Item name="notes" label="Заметки">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
