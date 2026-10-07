import { useEffect, useMemo, useRef, useState } from 'react';
import L, { type LeafletEventHandlerFnMap } from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  Fullscreen,
  Maximize2,
  Minimize2,
  Minus,
  Play,
  Plus,
  Route,
  Undo2,
  X,
} from 'lucide-react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data';
import {
  findNearestSettlement,
  loadMapGeography,
  type MapGeographyPayload,
} from '../mapGeography';
import type { MapViewport } from '../mapWindowSync';
import { placeIconSource } from '../placeIcons';
import type {
  ItemKind,
  MapItem,
  RoutePoint,
  VehiclePoint,
} from '../types';
import { MapLabelsLayer } from './MapLabelsLayer';

const MAP_BOUNDS = L.latLngBounds(
  [0, 0],
  [MAP_HEIGHT, MAP_WIDTH],
);

interface LocationCacheEntry {
  lat: number;
  lng: number;
  name: string;
}

interface MapViewProps {
  items: MapItem[];
  focusedItem: MapItem | null;
  placement: ItemKind | null;
  routeDraft: RoutePoint[] | null;
  routeVehicleId: string | null;
  isAdmin: boolean;
  excelConnected: boolean;
  onPlace: (lat: number, lng: number) => void;
  onEdit: (item: MapItem) => void;
  onMove: (id: string, lat: number, lng: number) => void;
  onUndoRoutePoint: () => void;
  onCancelRoute: () => void;
  onStartRoute: () => void;
  externalViewport?: MapViewport | null;
  onViewportChange?: (viewport: MapViewport) => void;
}

function useItemLocationNames(items: MapItem[]): Map<string, string> {
  const [geography, setGeography] = useState<MapGeographyPayload | null>(null);
  const cacheRef = useRef(new Map<string, LocationCacheEntry>());

  useEffect(() => {
    let active = true;
    loadMapGeography()
      .then((payload) => {
        if (active) setGeography(payload);
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      active = false;
    };
  }, []);

  return useMemo(() => {
    const names = new Map<string, string>();
    if (!geography) return names;

    const activeIds = new Set(items.map((item) => item.id));
    for (const cachedId of cacheRef.current.keys()) {
      if (!activeIds.has(cachedId)) cacheRef.current.delete(cachedId);
    }

    for (const item of items) {
      const cached = cacheRef.current.get(item.id);
      if (cached && Math.hypot(item.lat - cached.lat, item.lng - cached.lng) < 1.2) {
        names.set(item.id, cached.name);
        continue;
      }
      const nearest = findNearestSettlement(geography, item.lat, item.lng);
      if (!nearest) continue;
      const entry = { lat: item.lat, lng: item.lng, name: nearest.name };
      cacheRef.current.set(item.id, entry);
      names.set(item.id, entry.name);
    }
    return names;
  }, [geography, items]);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function markerIcon(item: MapItem, focused: boolean, locationName: string): L.DivIcon {
  const focusClass = focused ? ' is-focused' : '';
  const locationBadge = locationName
    ? `<span class="marker-location" title="Ближайший населённый пункт"><i></i>${escapeHtml(locationName)}</span>`
    : '';

  if (item.kind === 'person') {
    const iconSource = placeIconSource(item.placeIcon);
    return L.divIcon({
      className: 'leaflet-object-icon',
      iconSize: [92, 92],
      iconAnchor: [46, 46],
      tooltipAnchor: [0, -78],
      html: `
        <div class="object-marker person-object${focusClass}">
          ${locationBadge}
          <span class="marker-proximity"></span>
          <span class="person-pin">
            <span class="person-pin-core has-place-icon">
              <img src="${escapeHtml(iconSource)}" alt="" draggable="false" />
            </span>
          </span>
          <span class="marker-caption">${escapeHtml(item.pointName || 'Новая точка')}</span>
        </div>
      `,
    });
  }

  const statusClass = escapeHtml(item.status);
  return L.divIcon({
    className: 'leaflet-object-icon leaflet-vehicle-icon',
    iconSize: [96, 96],
    iconAnchor: [48, 48],
    tooltipAnchor: [0, -78],
    html: `
      <div class="object-marker vehicle-object ${statusClass}${focusClass}">
        ${locationBadge}
        <span class="marker-proximity"></span>
        <span class="vehicle-direction" style="transform: translate(-50%, -50%) rotate(${item.heading}deg)">
          <span class="direction-tip"></span>
        </span>
        <span class="vehicle-pin">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.8 3.5h8.4c1.2 0 2.1.8 2.4 1.9l1.1 4.1c.8.4 1.3 1.2 1.3 2.1v5.1c0 .7-.6 1.3-1.3 1.3h-.6v1.4c0 .6-.5 1.1-1.1 1.1h-1.1c-.6 0-1.1-.5-1.1-1.1V18H8.2v1.4c0 .6-.5 1.1-1.1 1.1H6c-.6 0-1.1-.5-1.1-1.1V18h-.6C3.6 18 3 17.4 3 16.7v-5.1c0-.9.5-1.7 1.3-2.1l1.1-4.1c.3-1.1 1.2-1.9 2.4-1.9Zm-.1 2L6.6 9.2h10.8l-1.1-3.7H7.7Zm-.9 6.1a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1Zm10.4 0a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1Z"/>
          </svg>
        </span>
        <span class="marker-caption">${escapeHtml(item.name || 'Новая машина')}</span>
      </div>
    `,
  });
}

function vehicleStatus(status: VehiclePoint['status']): string {
  if (status === 'moving') return 'В пути';
  if (status === 'service') return 'Обслуживание';
  return 'На стоянке';
}

function ObjectTooltip({ item, locationName }: { item: MapItem; locationName: string }) {
  if (item.kind === 'person') {
    return (
      <div className="map-tooltip-card point-personnel-tooltip">
        <div className="tooltip-topline">
          <span className="tooltip-type person">Точка · {item.personnel.length} сотр.</span>
          <span className="tooltip-live"><i /> {item.sheetName ? 'Excel' : 'Локально'}</span>
        </div>
        <strong className="tooltip-title">{item.pointName}</strong>
        {locationName && <span className="tooltip-location">Рядом: {locationName}</span>}
        {item.personnel.length > 0 ? (
          <div className="personnel-tooltip-scroll">
            <table className="personnel-tooltip-table">
              <thead>
                <tr><th>ФИО</th><th>Звание / должность</th></tr>
              </thead>
              <tbody>
                {item.personnel.map((person) => (
                  <tr key={person.id}>
                    <td>{person.fullName}</td>
                    <td>{person.position || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tooltip-personnel">На этом листе пока нет сотрудников</div>
        )}
      </div>
    );
  }

  return (
    <div className="map-tooltip-card vehicle-tooltip-card">
      <div className="tooltip-topline">
        <span className="tooltip-type vehicle">Служебная машина</span>
        <span className={`tooltip-vehicle-state ${item.status}`}>
          {vehicleStatus(item.status)}
        </span>
      </div>
      <strong className="tooltip-title">{item.name}</strong>
      <table>
        <tbody>
          <tr><th>Водитель</th><td>{item.driver || 'Не указан'}</td></tr>
          {locationName && <tr><th>Рядом</th><td>{locationName}</td></tr>}
          <tr><th>Статус</th><td>{vehicleStatus(item.status)}</td></tr>
          <tr><th>Курс</th><td>{Math.round(item.heading)}°</td></tr>
          {item.route.length > 1 && <tr><th>Маршрут</th><td>{item.route.length} точек</td></tr>}
          {item.route.length > 1 && <tr><th>Скорость</th><td>{Math.round(item.routeSpeed)} км/ч</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function constrainMapToBounds(map: L.Map, fit = false) {
  // Сначала снимаем прежний динамический минимум: после выхода из полного
  // экрана размер контейнера уменьшается, поэтому допустимый минимум тоже
  // должен пересчитаться вниз.
  map.setMinZoom(-4);
  // Минимальный масштаб выбирается так, чтобы окно всегда находилось внутри
  // покрытия: за границами локальных тайлов не появляется пустое поле.
  const fitZoom = map.getBoundsZoom(MAP_BOUNDS, true, L.point(0, 0));
  map.setMinZoom(fitZoom);
  map.setMaxBounds(MAP_BOUNDS);

  if (fit || map.getZoom() < fitZoom) {
    map.fitBounds(MAP_BOUNDS, { padding: [0, 0], animate: false });
  } else {
    map.panInsideBounds(MAP_BOUNDS, { animate: false });
  }
}

function OfflineMapLayers() {
  return (
    <>
      <TileLayer
        url="/maps/tiles/{z}/{x}/{y}.webp"
        bounds={MAP_BOUNDS}
        tileSize={512}
        minNativeZoom={0}
        maxNativeZoom={3}
        minZoom={-4}
        maxZoom={4}
        noWrap
        keepBuffer={2}
        updateWhenZooming
        updateWhenIdle
        className="offline-map-tiles"
      />
      <MapLabelsLayer />
    </>
  );
}

function FitMapOnStart() {
  const map = useMap();

  useEffect(() => {
    const fit = () => {
      map.invalidateSize({ animate: false, pan: false });
      constrainMapToBounds(map, true);
    };
    const keepInside = () => constrainMapToBounds(map);
    const frame = window.requestAnimationFrame(fit);
    map.on('resize', keepInside);

    return () => {
      window.cancelAnimationFrame(frame);
      map.off('resize', keepInside);
    };
  }, [map]);

  return null;
}

function ViewportController({
  externalViewport,
  onViewportChange,
}: {
  externalViewport: MapViewport | null;
  onViewportChange?: (viewport: MapViewport) => void;
}) {
  const map = useMap();
  const callbackRef = useRef(onViewportChange);
  const applyingExternalViewRef = useRef(false);
  const lastPublishedRef = useRef<MapViewport | null>(null);
  callbackRef.current = onViewportChange;

  useEffect(() => {
    const publishViewport = () => {
      if (applyingExternalViewRef.current || !callbackRef.current) return;
      const center = map.getCenter();
      const viewport: MapViewport = {
        center: { lat: center.lat, lng: center.lng },
        zoom: map.getZoom(),
      };
      const previous = lastPublishedRef.current;
      if (
        previous
        && Math.abs(previous.center.lat - viewport.center.lat) < 0.0001
        && Math.abs(previous.center.lng - viewport.center.lng) < 0.0001
        && Math.abs(previous.zoom - viewport.zoom) < 0.0001
      ) return;
      lastPublishedRef.current = viewport;
      callbackRef.current(viewport);
    };

    map.on('moveend zoomend', publishViewport);
    const initialFrame = window.requestAnimationFrame(publishViewport);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      map.off('moveend zoomend', publishViewport);
    };
  }, [map]);

  useEffect(() => {
    if (!externalViewport) return;
    const currentCenter = map.getCenter();
    if (
      Math.abs(currentCenter.lat - externalViewport.center.lat) < 0.0001
      && Math.abs(currentCenter.lng - externalViewport.center.lng) < 0.0001
      && Math.abs(map.getZoom() - externalViewport.zoom) < 0.0001
    ) {
      lastPublishedRef.current = {
        center: { lat: currentCenter.lat, lng: currentCenter.lng },
        zoom: map.getZoom(),
      };
      return;
    }

    applyingExternalViewRef.current = true;
    try {
      map.stop();
      map.setView(
        [externalViewport.center.lat, externalViewport.center.lng],
        externalViewport.zoom,
        { animate: false },
      );
      constrainMapToBounds(map);
      const appliedCenter = map.getCenter();
      lastPublishedRef.current = {
        center: { lat: appliedCenter.lat, lng: appliedCenter.lng },
        zoom: map.getZoom(),
      };
    } finally {
      applyingExternalViewRef.current = false;
    }
  }, [externalViewport, map]);

  return null;
}

function FocusController({ item }: { item: MapItem | null }) {
  const map = useMap();
  const lastFocusedId = useRef<string | null>(null);

  useEffect(() => {
    if (!item) {
      lastFocusedId.current = null;
      return;
    }
    if (lastFocusedId.current === item.id) return;
    lastFocusedId.current = item.id;
    map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 0.35), {
      animate: true,
      duration: 0.65,
    });
  }, [item, map]);

  return null;
}

function PlacementHandler({
  enabled,
  onPlace,
}: {
  enabled: boolean;
  onPlace: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      const lat = Math.min(MAP_HEIGHT, Math.max(0, event.latlng.lat));
      const lng = Math.min(MAP_WIDTH, Math.max(0, event.latlng.lng));
      onPlace(lat, lng);
    },
  });
  return null;
}

function MapControls() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  useEffect(() => {
    const handleFullscreenChange = () => {
      const wrapper = map.getContainer().closest('.map-wrap');
      setIsFullscreen(document.fullscreenElement === wrapper);
      window.setTimeout(() => {
        map.invalidateSize({ animate: false, pan: false });
        constrainMapToBounds(map);
      }, 80);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [map]);

  async function toggleFullscreen() {
    const wrapper = map.getContainer().closest<HTMLElement>('.map-wrap');
    if (!wrapper || !document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement === wrapper) {
        await document.exitFullscreen();
      } else {
        await wrapper.requestFullscreen();
      }
    } catch {
      // Браузер может запретить полноэкранный режим вне пользовательского клика.
    }
  }

  const cannotZoomOut = zoom <= map.getMinZoom() + 0.01;

  return (
    <div className="map-controls leaflet-control" onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => map.zoomIn()} aria-label="Приблизить карту" title="Приблизить">
        <Plus size={18} />
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        disabled={cannotZoomOut}
        aria-label="Отдалить карту"
        title="Отдалить"
      >
        <Minus size={18} />
      </button>
      <button
        type="button"
        onClick={() => constrainMapToBounds(map, true)}
        aria-label="Показать всю карту"
        title="Показать всю область"
      >
        <Maximize2 size={17} />
      </button>
      <button
        type="button"
        onClick={() => void toggleFullscreen()}
        disabled={!document.fullscreenEnabled}
        aria-label={isFullscreen ? 'Выйти из полноэкранного режима' : 'Открыть карту на весь экран'}
        title={isFullscreen ? 'Выйти из полного экрана' : 'На весь экран'}
      >
        {isFullscreen ? <Minimize2 size={17} /> : <Fullscreen size={17} />}
      </button>
    </div>
  );
}

function routePositions(route: RoutePoint[]): Array<[number, number]> {
  return route.map((point) => [point.lat, point.lng]);
}

function VehicleRoutes({
  items,
  focusedId,
  routeDraft,
  routeVehicleId,
}: {
  items: MapItem[];
  focusedId: string | null;
  routeDraft: RoutePoint[] | null;
  routeVehicleId: string | null;
}) {
  const vehicles = items.filter((item): item is VehiclePoint =>
    item.kind === 'vehicle' && item.route.length > 1 && item.id !== routeVehicleId,
  );

  return (
    <Pane name="vehicle-routes" style={{ zIndex: 430, pointerEvents: 'none' }}>
      {vehicles.map((vehicle) => (
        <Polyline
          key={`${vehicle.id}-outline`}
          positions={routePositions(vehicle.route)}
          interactive={false}
          pathOptions={{
            color: '#ffffff',
            weight: vehicle.id === focusedId ? 8 : 7,
            opacity: 0.78,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      ))}
      {vehicles.map((vehicle) => (
        <Polyline
          key={vehicle.id}
          positions={routePositions(vehicle.route)}
          interactive={false}
          pathOptions={{
            color: vehicle.id === focusedId ? '#006b92' : '#217d9a',
            weight: vehicle.id === focusedId ? 5 : 4,
            opacity: vehicle.id === focusedId ? 0.96 : 0.8,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      ))}
      {vehicles.map((vehicle) => (
        <CircleMarker
          key={`${vehicle.id}-destination`}
          center={[
            vehicle.route[vehicle.route.length - 1].lat,
            vehicle.route[vehicle.route.length - 1].lng,
          ]}
          radius={vehicle.id === focusedId ? 6 : 5}
          interactive={false}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: '#217d9a',
            fillOpacity: 1,
          }}
        />
      ))}

      {routeDraft && (
        <>
          {routeDraft.length > 1 && (
            <>
              <Polyline
                positions={routePositions(routeDraft)}
                interactive={false}
                pathOptions={{
                  color: '#ffffff',
                  weight: 8,
                  opacity: 0.82,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <Polyline
                positions={routePositions(routeDraft)}
                interactive={false}
                pathOptions={{
                  color: '#0879a4',
                  weight: 5,
                  opacity: 0.98,
                  dashArray: '10 8',
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </>
          )}
          {routeDraft.map((point, index) => (
            <CircleMarker
              key={`${index}-${point.lat}-${point.lng}`}
              center={[point.lat, point.lng]}
              radius={index === 0 ? 7 : 6}
              interactive={false}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: index === 0 ? '#15835d' : '#0879a4',
                fillOpacity: 1,
              }}
            />
          ))}
        </>
      )}
    </Pane>
  );
}

function MapObject({
  item,
  focused,
  locationName,
  editable,
  draggable,
  mapClickMode,
  onEdit,
  onMove,
}: {
  item: MapItem;
  focused: boolean;
  locationName: string;
  editable: boolean;
  draggable: boolean;
  mapClickMode: boolean;
  onEdit: (item: MapItem) => void;
  onMove: (id: string, lat: number, lng: number) => void;
}) {
  const icon = useMemo(
    () => markerIcon(item, focused, locationName),
    [item, focused, locationName],
  );

  const eventHandlers = useMemo<LeafletEventHandlerFnMap>(
    () => ({
      click(event) {
        if (editable) {
          L.DomEvent.stopPropagation(event.originalEvent);
          onEdit(item);
        }
      },
      mouseover(event) {
        event.target.openTooltip();
      },
      mouseout(event) {
        event.target.closeTooltip();
      },
      dragend(event) {
        const marker = event.target as L.Marker;
        const position = marker.getLatLng();
        onMove(
          item.id,
          Math.min(MAP_HEIGHT, Math.max(0, position.lat)),
          Math.min(MAP_WIDTH, Math.max(0, position.lng)),
        );
      },
    }),
    [draggable, editable, item, onEdit, onMove],
  );

  return (
    <Marker
      position={[item.lat, item.lng]}
      icon={icon}
      draggable={draggable}
      interactive={!mapClickMode}
      riseOnHover
      eventHandlers={eventHandlers}
      zIndexOffset={item.kind === 'vehicle' ? 80 : 40}
    >
      <Tooltip
        direction="top"
        opacity={1}
        className="object-tooltip"
        offset={[0, -4]}
      >
        <ObjectTooltip item={item} locationName={locationName} />
      </Tooltip>
    </Marker>
  );
}

function RouteBuilderPanel({
  vehicleName,
  pointCount,
  onUndo,
  onCancel,
  onStart,
}: {
  vehicleName: string;
  pointCount: number;
  onUndo: () => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  return (
    <div className="route-builder-panel" role="dialog" aria-label={`Построение маршрута машины ${vehicleName}`}>
      <div className="route-builder-icon"><Route size={20} /></div>
      <div className="route-builder-copy">
        <strong>Маршрут: {vehicleName}</strong>
        <span>
          {pointCount > 1
            ? `Добавлено остановок: ${pointCount - 1}. Можно продолжить маршрут или запустить движение.`
            : 'Первая точка — положение машины. Нажимайте на карту, чтобы проложить путь.'}
        </span>
      </div>
      <div className="route-builder-actions">
        <button type="button" onClick={onUndo} disabled={pointCount <= 1} title="Удалить последнюю точку">
          <Undo2 size={16} /> <span>Назад</span>
        </button>
        <button className="route-builder-cancel" type="button" onClick={onCancel}>
          <X size={16} /> <span>Отмена</span>
        </button>
        <button className="route-builder-start" type="button" onClick={onStart} disabled={pointCount <= 1}>
          <Play size={16} fill="currentColor" /> <span>Запустить</span>
        </button>
      </div>
    </div>
  );
}

export function MapView({
  items,
  focusedItem,
  placement,
  routeDraft,
  routeVehicleId,
  isAdmin,
  excelConnected,
  onPlace,
  onEdit,
  onMove,
  onUndoRoutePoint,
  onCancelRoute,
  onStartRoute,
  externalViewport = null,
  onViewportChange,
}: MapViewProps) {
  const routeVehicle = routeVehicleId
    ? items.find((item): item is VehiclePoint => item.id === routeVehicleId && item.kind === 'vehicle')
    : null;
  const itemLocationNames = useItemLocationNames(items);

  return (
    <div className={`map-wrap ${placement ? 'is-placing' : ''} ${routeDraft ? 'is-routing' : ''}`}>
      <MapContainer
        className="company-map"
        crs={L.CRS.Simple}
        center={[MAP_HEIGHT / 2, MAP_WIDTH / 2]}
        zoom={0}
        minZoom={-4}
        maxZoom={3.5}
        maxBounds={MAP_BOUNDS}
        maxBoundsViscosity={1}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelDebounceTime={25}
        wheelPxPerZoomLevel={80}
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
        zoomControl={false}
        attributionControl={false}
        preferCanvas={false}
      >
        <OfflineMapLayers />
        <VehicleRoutes
          items={items}
          focusedId={focusedItem?.id ?? null}
          routeDraft={routeDraft}
          routeVehicleId={routeVehicleId}
        />
        <FitMapOnStart />
        <FocusController item={focusedItem} />
        <ViewportController
          externalViewport={externalViewport}
          onViewportChange={onViewportChange}
        />
        <PlacementHandler enabled={placement !== null || routeDraft !== null} onPlace={onPlace} />
        {items.map((item) => (
          <MapObject
            key={item.id}
            item={item}
            focused={item.id === focusedItem?.id}
            locationName={itemLocationNames.get(item.id) ?? ''}
            editable={
              isAdmin
              && placement === null
              && routeDraft === null
              && (item.kind === 'vehicle' || excelConnected)
            }
            draggable={
              isAdmin
              && placement === null
              && routeDraft === null
              && (item.kind === 'vehicle' || excelConnected)
              && !(item.kind === 'vehicle' && item.status === 'moving' && item.route.length > 1)
            }
            mapClickMode={placement !== null || routeDraft !== null}
            onEdit={onEdit}
            onMove={onMove}
          />
        ))}
        <MapControls />
      </MapContainer>

      {routeDraft && (
        <RouteBuilderPanel
          vehicleName={routeVehicle?.name || 'машина'}
          pointCount={routeDraft.length}
          onUndo={onUndoRoutePoint}
          onCancel={onCancelRoute}
          onStart={onStartRoute}
        />
      )}
      <div className="map-legend" aria-label="Условные обозначения">
        <span><i className="legend-dot person" /> Точка</span>
        <span><i className="legend-dot vehicle" /> Машина</span>
      </div>
    </div>
  );
}
