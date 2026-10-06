import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CarFront,
  Crosshair,
  FileSpreadsheet,
  Link2,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  Unlink,
  WifiOff,
  X,
} from 'lucide-react';
import { AdminModal } from './components/AdminModal';
import { DetachedMapWindow } from './components/DetachedMapWindow';
import { EditorPanel } from './components/EditorPanel';
import { ExcelWorkbookModal } from './components/ExcelWorkbookModal';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { SESSION_KEY } from './auth';
import {
  itemSubtitle,
  itemTitle,
  loadItems,
  makeDraft,
  mapLatitudeToGeographicLatitude,
  MAP_GEOGRAPHIC_BOUNDS,
  MAP_WIDTH,
  STORAGE_KEY,
} from './data';
import { useExcelWorkbook } from './hooks/useExcelWorkbook';
import {
  isMapWindowMessage,
  MAP_VIEW_LINK_STORAGE_KEY,
  MAP_WINDOW_CHANNEL,
  MAP_WINDOW_NAME,
  MAP_WINDOW_QUERY,
  type DetachedMapState,
  type MapViewport,
  type MapWindowMessage,
} from './mapWindowSync';
import type {
  EditorState,
  ItemFilter,
  ItemKind,
  MapItem,
  PersonPoint,
  RoutePoint,
  VehiclePoint,
  VehicleStatus,
} from './types';

interface RouteBuilderState {
  vehicleId: string;
  points: RoutePoint[];
  speed: number;
  previousStatus: VehicleStatus;
}

const MAP_MIN_LONGITUDE = MAP_GEOGRAPHIC_BOUNDS.west;
const MAP_MAX_LONGITUDE = MAP_GEOGRAPHIC_BOUNDS.east;
const KILOMETRES_PER_LATITUDE_DEGREE = 111.32;
// Для наглядности одна реальная секунда показывает одну минуту движения машины.
const SIMULATION_TIME_SCALE = 60;

function routeSegmentMetrics(from: RoutePoint, to: RoutePoint) {
  const fromLatitude = mapLatitudeToGeographicLatitude(from.lat);
  const toLatitude = mapLatitudeToGeographicLatitude(to.lat);
  const latitude = (fromLatitude + toLatitude) / 2;
  const northKm = (toLatitude - fromLatitude) * KILOMETRES_PER_LATITUDE_DEGREE;
  const eastKm = ((to.lng - from.lng) / MAP_WIDTH)
    * (MAP_MAX_LONGITUDE - MAP_MIN_LONGITUDE)
    * KILOMETRES_PER_LATITUDE_DEGREE
    * Math.cos(latitude * Math.PI / 180);
  return {
    distance: Math.hypot(northKm, eastKm),
    heading: (Math.atan2(eastKm, northKm) * 180 / Math.PI + 360) % 360,
  };
}

function advanceVehicle(vehicle: VehiclePoint, elapsedSeconds: number): VehiclePoint {
  if (vehicle.status !== 'moving' || vehicle.route.length < 2) return vehicle;

  const finalIndex = vehicle.route.length - 1;
  let segment = Math.min(Math.max(0, vehicle.routeSegment), finalIndex);
  let progress = Math.min(1, Math.max(0, vehicle.routeProgress));
  let distanceToTravel = Math.max(0, vehicle.routeSpeed)
    * elapsedSeconds
    * SIMULATION_TIME_SCALE
    / 3600;
  let lat = vehicle.lat;
  let lng = vehicle.lng;
  let heading = vehicle.heading;

  while (segment < finalIndex) {
    const from = vehicle.route[segment];
    const to = vehicle.route[segment + 1];
    const metrics = routeSegmentMetrics(from, to);
    heading = metrics.heading;

    if (metrics.distance < 0.0001) {
      segment += 1;
      progress = 0;
      lat = to.lat;
      lng = to.lng;
      continue;
    }

    const remainingDistance = metrics.distance * (1 - progress);
    if (distanceToTravel < remainingDistance) {
      progress += distanceToTravel / metrics.distance;
      lat = from.lat + (to.lat - from.lat) * progress;
      lng = from.lng + (to.lng - from.lng) * progress;
      distanceToTravel = 0;
      break;
    }

    distanceToTravel -= remainingDistance;
    segment += 1;
    progress = 0;
    lat = to.lat;
    lng = to.lng;
  }

  const finished = segment >= finalIndex;
  const finalPoint = vehicle.route[finalIndex];
  return {
    ...vehicle,
    lat: finished ? finalPoint.lat : lat,
    lng: finished ? finalPoint.lng : lng,
    heading,
    routeSegment: segment,
    routeProgress: finished ? 0 : progress,
    status: finished ? 'parked' : 'moving',
    updatedAt: new Date().toISOString(),
  };
}

function routePointsDiffer(left: RoutePoint, right: RoutePoint): boolean {
  return Math.hypot(left.lat - right.lat, left.lng - right.lng) >= 1;
}

function loadViewLinkSetting(): boolean {
  return localStorage.getItem(MAP_VIEW_LINK_STORAGE_KEY) !== 'false';
}

function MainApp() {
  const [items, setItems] = useState<MapItem[]>(loadItems);
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [search, setSearch] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<ItemKind | null>(null);
  const [routeBuilder, setRouteBuilder] = useState<RouteBuilderState | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [adminName, setAdminName] = useState<string | null>(() =>
    sessionStorage.getItem(SESSION_KEY),
  );
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [workbookModalOpen, setWorkbookModalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [detachedMapOpen, setDetachedMapOpen] = useState(false);
  const [viewLinked, setViewLinked] = useState(loadViewLinkSetting);
  const [mainViewport, setMainViewport] = useState<MapViewport | null>(null);
  const [remoteViewport, setRemoteViewport] = useState<MapViewport | null>(null);
  const [toast, setToast] = useState('');
  const mapChannelRef = useRef<BroadcastChannel | null>(null);
  const detachedWindowRef = useRef<Window | null>(null);
  const lastDetachedContactRef = useRef(0);
  const detachedStateRef = useRef<DetachedMapState | null>(null);
  const mapMessageHandlerRef = useRef<(message: unknown) => void>(() => undefined);
  const excel = useExcelWorkbook();

  const isAdmin = adminName !== null;
  const pointItems = useMemo(
    () => items.filter((item): item is PersonPoint => item.kind === 'person'),
    [items],
  );
  const hasMovingVehicles = items.some((item) =>
    item.kind === 'vehicle'
    && item.status === 'moving'
    && item.route.length > 1,
  );

  useEffect(() => {
    if (!hasMovingVehicles) return;
    let previousTime = performance.now();
    const timer = window.setInterval(() => {
      const currentTime = performance.now();
      const elapsedSeconds = Math.min(0.5, Math.max(0, (currentTime - previousTime) / 1000));
      previousTime = currentTime;
      setItems((current) => {
        let changed = false;
        const advanced = current.map((item) => {
          if (item.kind !== 'vehicle') return item;
          const next = advanceVehicle(item, elapsedSeconds);
          if (next !== item) changed = true;
          return next;
        });
        return changed ? advanced : current;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [hasMovingVehicles]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return items.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!query) return true;
      const personnelText = item.kind === 'person'
        ? item.personnel.map((person) => `${person.fullName} ${person.position}`).join(' ')
        : '';
      const haystack = `${itemTitle(item)} ${itemSubtitle(item)} ${personnelText}`.toLocaleLowerCase('ru-RU');
      return haystack.includes(query);
    });
  }, [filter, items, search]);

  const visibleFocusedItem = useMemo(
    () => filteredItems.find((item) => item.id === focusedId) ?? null,
    [filteredItems, focusedId],
  );
  const editorVehicleRuntime = useMemo(() => {
    if (!editor || editor.item.kind !== 'vehicle') return undefined;
    return items.find((item): item is VehiclePoint =>
      item.id === editor.item.id && item.kind === 'vehicle',
    );
  }, [editor, items]);

  detachedStateRef.current = {
    items: filteredItems,
    focusedId: visibleFocusedItem?.id ?? null,
    placement,
    routeDraft: routeBuilder?.points ?? null,
    routeVehicleId: routeBuilder?.vehicleId ?? null,
    isAdmin,
    excelConnected: excel.isConnected,
    viewLinked,
    viewport: mainViewport,
  };

  function cancelRouteBuilder(showToast = true) {
    if (!routeBuilder) return;
    const { vehicleId, previousStatus } = routeBuilder;
    setItems((current) => current.map((item) =>
      item.id === vehicleId && item.kind === 'vehicle'
        ? { ...item, status: previousStatus, updatedAt: new Date().toISOString() }
        : item,
    ));
    setRouteBuilder(null);
    if (showToast) setToast('Построение маршрута отменено');
  }

  function startPlacement(kind: ItemKind) {
    if (!isAdmin) {
      setAdminModalOpen(true);
      return;
    }
    if (kind === 'person' && !excel.isConnected) {
      setToast('Сначала привяжите рабочую Excel-книгу');
      setWorkbookModalOpen(true);
      return;
    }
    if (routeBuilder) cancelRouteBuilder(false);
    setEditor(null);
    setFocusedId(null);
    setPlacement((current) => (current === kind ? null : kind));
  }

  function handlePlace(lat: number, lng: number) {
    if (!isAdmin) return;
    if (routeBuilder) {
      setRouteBuilder((current) => {
        if (!current || current.points.length >= 100) return current;
        const lastPoint = current.points[current.points.length - 1];
        if (!routePointsDiffer(lastPoint, { lat, lng })) return current;
        return { ...current, points: [...current.points, { lat, lng }] };
      });
      return;
    }
    if (!placement) return;
    const draft = makeDraft(placement, lat, lng);
    setEditor({ mode: 'create', item: draft });
    setPlacement(null);
  }

  function handleEdit(item: MapItem) {
    if (!isAdmin) return;
    if (routeBuilder && routeBuilder.vehicleId !== item.id) {
      setToast('Сначала завершите или отмените построение маршрута');
      return;
    }
    if (item.kind === 'person' && !excel.isConnected) {
      setToast('Чтобы изменить точку, снова привяжите Excel-книгу');
      setWorkbookModalOpen(true);
      return;
    }
    setPlacement(null);
    setFocusedId(item.id);
    setEditor({ mode: 'edit', item: structuredClone(item) });
  }

  async function handleSave(item: MapItem) {
    if (!editor) return;
    const editorSnapshot = editor;
    let savedItem = item;

    if (item.kind === 'person' && excel.isConnected) {
      const previous = editorSnapshot.mode === 'edit' && editorSnapshot.item.kind === 'person'
        ? editorSnapshot.item
        : undefined;
      const pointsForSave = editorSnapshot.mode === 'create'
        ? [...pointItems, item]
        : pointItems.map((point) => point.id === item.id ? item : point);
      try {
        savedItem = await excel.savePoint(item, previous, pointsForSave);
      } catch {
        setToast('Не удалось сохранить точку в Excel');
        return;
      }
    }

    setItems((current) => {
      if (editorSnapshot.mode === 'create') return [...current, savedItem];
      return current.map((existing) => existing.id === savedItem.id ? savedItem : existing);
    });
    setFilter('all');
    setSearch('');
    setFocusedId(savedItem.id);
    setEditor(null);
    setToast(editorSnapshot.mode === 'create'
      ? savedItem.kind === 'person' && excel.isConnected
        ? 'Точка и новый лист Excel созданы'
        : 'Объект добавлен на карту'
      : 'Изменения сохранены');
  }

  function beginVehicleRoute(id: string, speed: number) {
    const vehicle = items.find((item): item is VehiclePoint =>
      item.id === id && item.kind === 'vehicle',
    );
    if (!vehicle) return;
    if (routeBuilder) {
      if (routeBuilder.vehicleId !== id) {
        setToast('Сначала завершите или отмените текущий маршрут');
      }
      return;
    }

    const normalizedSpeed = Math.min(500, Math.max(1, speed));
    setItems((current) => current.map((item) =>
      item.id === id && item.kind === 'vehicle'
        ? { ...item, status: 'parked', updatedAt: new Date().toISOString() }
        : item,
    ));
    setRouteBuilder({
      vehicleId: id,
      points: [{ lat: vehicle.lat, lng: vehicle.lng }],
      speed: normalizedSpeed,
      previousStatus: vehicle.status,
    });
    setPlacement(null);
    setFilter('all');
    setSearch('');
    setFocusedId(id);
    setToast('Отмечайте точки маршрута последовательными нажатиями на карту');
  }

  function undoRoutePoint() {
    setRouteBuilder((current) => {
      if (!current || current.points.length <= 1) return current;
      return { ...current, points: current.points.slice(0, -1) };
    });
  }

  function startVehicleRoute() {
    if (!routeBuilder || routeBuilder.points.length < 2) return;
    const { vehicleId, points, speed } = routeBuilder;
    const heading = routeSegmentMetrics(points[0], points[1]).heading;
    setItems((current) => current.map((item) =>
      item.id === vehicleId && item.kind === 'vehicle'
        ? {
            ...item,
            lat: points[0].lat,
            lng: points[0].lng,
            heading,
            status: 'moving',
            route: points,
            routeSegment: 0,
            routeProgress: 0,
            routeSpeed: speed,
            updatedAt: new Date().toISOString(),
          }
        : item,
    ));
    setRouteBuilder(null);
    setToast('Маршрут сохранён · машина начала движение');
  }

  function toggleVehicleMotion(id: string, speed: number) {
    const vehicle = items.find((item): item is VehiclePoint =>
      item.id === id && item.kind === 'vehicle',
    );
    if (!vehicle || vehicle.route.length < 2) return;
    const finished = vehicle.routeSegment >= vehicle.route.length - 1;
    const normalizedSpeed = Math.min(500, Math.max(1, speed));

    setItems((current) => current.map((item) => {
      if (item.id !== id || item.kind !== 'vehicle' || item.route.length < 2) return item;
      if (item.status === 'moving') {
        return {
          ...item,
          status: 'parked',
          routeSpeed: normalizedSpeed,
          updatedAt: new Date().toISOString(),
        };
      }
      const currentFinished = item.routeSegment >= item.route.length - 1;
      if (currentFinished) {
        const firstPoint = item.route[0];
        return {
          ...item,
          lat: firstPoint.lat,
          lng: firstPoint.lng,
          heading: routeSegmentMetrics(item.route[0], item.route[1]).heading,
          status: 'moving',
          routeSegment: 0,
          routeSpeed: normalizedSpeed,
          routeProgress: 0,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...item,
        heading: routeSegmentMetrics(item.route[item.routeSegment], item.route[item.routeSegment + 1]).heading,
        status: 'moving',
        routeSpeed: normalizedSpeed,
        updatedAt: new Date().toISOString(),
      };
    }));
    setToast(vehicle.status === 'moving'
      ? 'Движение машины приостановлено'
      : finished ? 'Машина начала маршрут заново' : 'Движение машины продолжено');
  }

  function clearVehicleRoute(id: string) {
    setItems((current) => current.map((item) =>
      item.id === id && item.kind === 'vehicle'
        ? {
            ...item,
            status: 'parked',
            route: [],
            routeSegment: 0,
            routeProgress: 0,
            updatedAt: new Date().toISOString(),
          }
        : item,
    ));
    setToast('Маршрут машины удалён');
  }

  function openWorkbook() {
    if (!isAdmin) {
      setAdminModalOpen(true);
      return;
    }
    if (routeBuilder) cancelRouteBuilder(false);
    setPlacement(null);
    setEditor(null);
    setToast('');
    setWorkbookModalOpen(true);
  }

  function handleWorkbookPoints(points: PersonPoint[]) {
    setItems((current) => [
      ...points,
      ...current.filter((item) => item.kind === 'vehicle'),
    ]);
    setFilter('person');
    setSearch('');
    setFocusedId(points.length === 1 ? points[0].id : null);
    setToast(`Excel подключён · загружено точек: ${points.length}`);
  }

  async function handleDelete(id: string) {
    const target = items.find((item) => item.id === id);
    if (!target) return;
    const remainingItems = items.filter((item) => item.id !== id);

    if (target.kind === 'person' && excel.isConnected && target.excelId) {
      try {
        await excel.deletePoint(
          target,
          remainingItems.filter((item): item is PersonPoint => item.kind === 'person'),
        );
      } catch {
        setToast('Не удалось удалить лист из Excel');
        return;
      }
    }

    setItems(remainingItems);
    if (routeBuilder?.vehicleId === id) setRouteBuilder(null);
    if (focusedId === id) setFocusedId(null);
    setEditor(null);
    setToast(target.kind === 'person' && target.excelId
      ? 'Точка и лист Excel удалены'
      : 'Объект удалён');
  }

  function handleMove(id: string, lat: number, lng: number) {
    const updatedAt = new Date().toISOString();
    const updatedItems = items.map((item) => {
      if (item.id !== id) return item;
      if (item.kind === 'person') return { ...item, lat, lng, updatedAt };

      const remainingRoute = item.route.length > 1
        ? item.route.slice(Math.min(item.routeSegment + 1, item.route.length))
        : [];
      const route = remainingRoute.length > 0 ? [{ lat, lng }, ...remainingRoute] : [];
      return {
        ...item,
        lat,
        lng,
        status: 'parked' as const,
        route,
        routeSegment: 0,
        routeProgress: 0,
        heading: route.length > 1 ? routeSegmentMetrics(route[0], route[1]).heading : item.heading,
        updatedAt,
      };
    });
    setItems(updatedItems);
    setEditor((current) => current?.item.id === id
      ? { ...current, item: { ...current.item, lat, lng, updatedAt } }
      : current);

    const movedPoint = updatedItems.find(
      (item): item is PersonPoint => item.id === id && item.kind === 'person',
    );
    if (movedPoint && excel.isConnected) {
      void excel.savePositions(
        updatedItems.filter((item): item is PersonPoint => item.kind === 'person'),
      ).catch(() => setToast('Координаты изменены локально, но Excel не сохранён'));
    }
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    excel.disconnect();
    if (routeBuilder) cancelRouteBuilder(false);
    setAdminName(null);
    setPlacement(null);
    setEditor(null);
    setWorkbookModalOpen(false);
    setToast('Режим администратора выключен');
  }

  function postToDetachedMap(message: MapWindowMessage) {
    if (mapChannelRef.current) {
      mapChannelRef.current.postMessage(message);
      return;
    }
    const detachedWindow = detachedWindowRef.current;
    if (detachedWindow && !detachedWindow.closed) {
      detachedWindow.postMessage(message, window.location.origin);
    }
  }

  function sendDetachedMapState() {
    if (!detachedStateRef.current) return;
    postToDetachedMap({ type: 'controller-state', state: detachedStateRef.current });
  }

  function handleMainViewportChange(viewport: MapViewport) {
    setMainViewport(viewport);
    if (viewLinked) {
      postToDetachedMap({ type: 'map-view', source: 'controller', viewport });
    }
  }

  function updateViewLink(linked: boolean, announce = true) {
    localStorage.setItem(MAP_VIEW_LINK_STORAGE_KEY, String(linked));
    setRemoteViewport(null);
    setViewLinked(linked);
    postToDetachedMap({ type: 'view-link-set', linked });
    if (linked && mainViewport) {
      postToDetachedMap({ type: 'map-view', source: 'controller', viewport: mainViewport });
    }
    if (announce) {
      setToast(linked
        ? 'Обзор карт связан: перемещение и масштаб синхронизируются'
        : 'Включён независимый обзор карт');
    }
  }

  function openDetachedMap() {
    const existingWindow = detachedWindowRef.current;
    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus();
      sendDetachedMapState();
      setDetachedMapOpen(true);
      return;
    }

    const detachedUrl = new URL(window.location.href);
    detachedUrl.searchParams.set(MAP_WINDOW_QUERY, '1');
    detachedUrl.hash = '';
    const openedWindow = window.open(
      detachedUrl.toString(),
      MAP_WINDOW_NAME,
      'popup=yes,width=1280,height=800,resizable=yes,scrollbars=no',
    );
    if (!openedWindow) {
      setToast('Браузер заблокировал отдельное окно карты. Разрешите всплывающие окна для этого сайта.');
      return;
    }
    detachedWindowRef.current = openedWindow;
    lastDetachedContactRef.current = Date.now();
    setDetachedMapOpen(true);
    openedWindow.focus();
    window.setTimeout(sendDetachedMapState, 300);
  }

  mapMessageHandlerRef.current = (value: unknown) => {
    if (!isMapWindowMessage(value)) return;
    switch (value.type) {
      case 'detached-ready':
      case 'request-state':
        lastDetachedContactRef.current = Date.now();
        setDetachedMapOpen(true);
        sendDetachedMapState();
        break;
      case 'detached-heartbeat':
        lastDetachedContactRef.current = Date.now();
        setDetachedMapOpen(true);
        break;
      case 'detached-closing':
        lastDetachedContactRef.current = 0;
        setDetachedMapOpen(false);
        detachedWindowRef.current = null;
        break;
      case 'focus-controller':
        window.focus();
        break;
      case 'map-view':
        if (value.source === 'detached' && viewLinked) {
          setMainViewport(value.viewport);
          setRemoteViewport(value.viewport);
        }
        break;
      case 'view-link-set':
        updateViewLink(value.linked);
        break;
      case 'map-place':
        if (Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
          const opensEditor = routeBuilder === null && placement !== null;
          handlePlace(value.lat, value.lng);
          if (opensEditor) window.focus();
        }
        break;
      case 'map-edit': {
        const item = items.find((candidate) => candidate.id === value.id);
        if (item) {
          handleEdit(item);
          window.focus();
        }
        break;
      }
      case 'map-move':
        if (Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
          handleMove(value.id, value.lat, value.lng);
        }
        break;
      case 'map-focus':
        if (items.some((item) => item.id === value.id)) setFocusedId(value.id);
        break;
      case 'route-undo':
        undoRoutePoint();
        break;
      case 'route-cancel':
        cancelRouteBuilder();
        break;
      case 'route-start':
        startVehicleRoute();
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    const receiveMessage = (message: unknown) => mapMessageHandlerRef.current(message);
    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(MAP_WINDOW_CHANNEL);
      mapChannelRef.current = channel;
      channel.onmessage = (event: MessageEvent<unknown>) => receiveMessage(event.data);
    }

    const handleWindowMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      receiveMessage(event.data);
    };
    window.addEventListener('message', handleWindowMessage);

    const handleBeforeUnload = () => postToDetachedMap({ type: 'controller-closing' });
    window.addEventListener('beforeunload', handleBeforeUnload);

    const heartbeatTimer = window.setInterval(() => {
      const detachedWindow = detachedWindowRef.current;
      const contactExpired = lastDetachedContactRef.current > 0
        && Date.now() - lastDetachedContactRef.current > 5500;
      if (detachedWindow?.closed || contactExpired) {
        detachedWindowRef.current = null;
        lastDetachedContactRef.current = 0;
        setDetachedMapOpen(false);
      } else {
        postToDetachedMap({ type: 'controller-heartbeat' });
      }
    }, 2000);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('message', handleWindowMessage);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channel?.close();
      mapChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    sendDetachedMapState();
  }, [excel.isConnected, filteredItems, isAdmin, placement, routeBuilder, viewLinked, visibleFocusedItem?.id]);

  const excelButtonLabel = excel.state.status === 'saving'
    ? 'Сохраняем Excel…'
    : excel.isConnected
      ? excel.state.fileName
      : excel.state.status === 'error'
        ? 'Ошибка Excel'
        : 'Привязать Excel';

  return (
    <div className="app-shell">
      <Sidebar
        items={filteredItems}
        allItems={items}
        filter={filter}
        search={search}
        focusedId={focusedId}
        mobileOpen={mobileSidebarOpen}
        isAdmin={isAdmin}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onFocus={(item) => setFocusedId(item.id)}
        onEdit={handleEdit}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title-group">
            <button className="icon-button mobile-menu-button" type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Открыть список объектов">
              <Menu size={21} />
            </button>
            <div>
              <div className="breadcrumb"><span>Главная</span><i /> <strong>Карта объектов</strong></div>
              <h1>Оперативная карта</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              className={`detached-map-button ${detachedMapOpen ? 'active' : ''}`}
              type="button"
              onClick={openDetachedMap}
              aria-label={detachedMapOpen ? 'Перейти к отдельному окну карты' : 'Открыть карту в отдельном окне'}
              title={detachedMapOpen ? 'Показать отдельное окно карты' : 'Открыть интерактивную карту для второго экрана'}
            >
              <Monitor size={16} />
              <span>{detachedMapOpen ? 'Карта открыта' : 'Отдельная карта'}</span>
              <i />
            </button>
            {detachedMapOpen && (
              <button
                className={`map-view-link-button ${viewLinked ? 'linked' : 'independent'}`}
                type="button"
                onClick={() => updateViewLink(!viewLinked)}
                aria-label={viewLinked ? 'Отключить привязку обзора карт' : 'Связать обзор основной и отдельной карт'}
                aria-pressed={viewLinked}
                title={viewLinked
                  ? 'Карты связаны: отключить синхронизацию перемещения и масштаба'
                  : 'Независимый обзор: связать перемещение и масштаб карт'}
                data-view-linked={viewLinked ? 'true' : 'false'}
              >
                {viewLinked ? <Link2 size={15} /> : <Unlink size={15} />}
                <span>{viewLinked ? 'Карты связаны' : 'Независимый обзор'}</span>
              </button>
            )}
            <div className="offline-badge" title="Карта не использует интернет"><WifiOff size={15} /><span>Офлайн</span></div>
            {isAdmin ? (
              <div className="admin-session">
                <div className="admin-session-copy"><span><i /> Режим управления</span><strong>{adminName}</strong></div>
                <button className="icon-button logout-button" type="button" onClick={logout} aria-label="Выйти из режима администратора" title="Выйти"><LogOut size={18} /></button>
              </div>
            ) : (
              <button className="admin-login-button" type="button" onClick={() => setAdminModalOpen(true)}><LockKeyhole size={16} /><span>Администратор</span></button>
            )}
          </div>
        </header>

        {isAdmin && (
          <div className="admin-toolbar">
            <div className="admin-toolbar-status">
              <ShieldCheck size={17} /><span>Редактирование включено</span><small>{excel.isConnected ? 'Точки связаны с Excel' : 'Для точек подключите Excel'}</small>
            </div>
            <div className="admin-toolbar-actions">
              <button
                className={`toolbar-add-button import ${excel.isConnected ? 'connected' : ''} ${excel.state.status === 'error' ? 'has-error' : ''}`}
                type="button"
                onClick={openWorkbook}
                title={excelButtonLabel}
              >
                <span className="toolbar-icon">
                  {excel.state.status === 'saving' ? <RefreshCw className="spin" size={16} /> : <FileSpreadsheet size={16} />}
                </span>
                <span className="toolbar-button-label">{excelButtonLabel}</span>
              </button>
              <button className={`toolbar-add-button person ${placement === 'person' ? 'active' : ''}`} type="button" onClick={() => startPlacement('person')}>
                <span className="toolbar-icon"><MapPin size={16} /></span>
                <span className="toolbar-button-label">{placement === 'person' ? 'Отменить точку' : 'Добавить точку'}</span>
                {placement !== 'person' && <Plus size={14} />}
              </button>
              <button className={`toolbar-add-button vehicle ${placement === 'vehicle' ? 'active' : ''}`} type="button" onClick={() => startPlacement('vehicle')}>
                <span className="toolbar-icon"><CarFront size={17} /></span>
                <span className="toolbar-button-label">{placement === 'vehicle' ? 'Отменить машину' : 'Добавить машину'}</span>
                {placement !== 'vehicle' && <Plus size={14} />}
              </button>
            </div>
          </div>
        )}

        <section className="map-stage" aria-label="Карта объектов компании">
          {placement && (
            <div className="placement-banner">
              <span className={`placement-banner-icon ${placement}`}>{placement === 'person' ? <MapPin size={19} /> : <CarFront size={19} />}</span>
              <div><strong>{placement === 'person' ? 'Выберите место для новой точки' : 'Укажите положение машины'}</strong><small>Нажмите в нужном месте на карте</small></div>
              <Crosshair className="placement-crosshair" size={20} />
              <button type="button" onClick={() => setPlacement(null)} aria-label="Отменить размещение"><X size={17} /></button>
            </div>
          )}

          <MapView
            items={filteredItems}
            focusedItem={visibleFocusedItem}
            placement={placement}
            routeDraft={routeBuilder?.points ?? null}
            routeVehicleId={routeBuilder?.vehicleId ?? null}
            isAdmin={isAdmin}
            excelConnected={excel.isConnected}
            onPlace={handlePlace}
            onEdit={handleEdit}
            onMove={handleMove}
            onUndoRoutePoint={undoRoutePoint}
            onCancelRoute={() => cancelRouteBuilder()}
            onStartRoute={startVehicleRoute}
            externalViewport={viewLinked ? remoteViewport : null}
            onViewportChange={handleMainViewportChange}
          />

          {editor && (
            <EditorPanel
              editor={editor}
              excelConnected={excel.isConnected}
              saving={excel.state.status === 'saving'}
              vehicleRuntime={editorVehicleRuntime}
              routeBuilding={routeBuilder?.vehicleId === editor.item.id}
              onCancel={() => setEditor(null)}
              onSave={handleSave}
              onDelete={(id) => void handleDelete(id)}
              onBeginRoute={beginVehicleRoute}
              onToggleVehicleMotion={toggleVehicleMotion}
              onClearVehicleRoute={clearVehicleRoute}
            />
          )}
        </section>
      </main>

      <AdminModal
        open={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
        onAuthenticated={(username) => {
          setAdminName(username);
          setToast('Режим администратора включён');
        }}
      />

      {workbookModalOpen && (
        <ExcelWorkbookModal
          state={excel.state}
          points={pointItems}
          onClose={() => setWorkbookModalOpen(false)}
          onConnect={() => excel.connect(pointItems)}
          onRefresh={() => excel.refresh(pointItems)}
          onPointsLoaded={handleWorkbookPoints}
          onDisconnect={() => {
            excel.disconnect();
            setToast('Excel-файл отключён');
          }}
          onClearError={excel.clearError}
        />
      )}

      {toast && <div className="toast" role="status"><span><i /></span>{toast}</div>}
    </div>
  );
}

export default function App() {
  const isDetachedMap = new URLSearchParams(window.location.search).get(MAP_WINDOW_QUERY) === '1';
  return isDetachedMap ? <DetachedMapWindow /> : <MainApp />;
}
