import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L, { type LeafletEventHandlerFnMap } from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  Check,
  ChevronDown,
  Fullscreen,
  Layers3,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Route,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data';
import {
  findNearestSettlement,
  loadMapGeography,
  type MapGeographyPayload,
} from '../mapGeography';
import {
  cloneFrontlineSegments,
  formatFrontlineDate,
  type FrontlineSnapshot,
  useFrontlineLayer,
} from '../frontline';
import {
  MAP_LAYER_OPTIONS,
  type MapLayerMode,
  useMapLayerMode,
} from '../mapLayers';
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

const FRONTLINE_VERTEX_ICON = L.divIcon({
  className: 'frontline-vertex-icon',
  html: '<span></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const FRONTLINE_VERTEX_SELECTED_ICON = L.divIcon({
  className: 'frontline-vertex-icon is-selected',
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

interface FrontlineVertexSelection {
  segmentIndex: number;
  pointIndex: number;
}

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

function ObjectTooltip({
  item,
  locationName,
  pinned = false,
  editable = false,
  onEdit,
}: {
  item: MapItem;
  locationName: string;
  pinned?: boolean;
  editable?: boolean;
  onEdit?: () => void;
}) {
  const makePersonnelListInteractive = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    // Leaflet normally interprets the wheel/touch gestures as map controls.
    // Keep every gesture that starts over the personnel list inside the list.
    L.DomEvent.disableScrollPropagation(node);
    L.DomEvent.disableClickPropagation(node);
  }, []);

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
          <div
            ref={makePersonnelListInteractive}
            className="personnel-tooltip-scroll"
            role="region"
            aria-label={`Список людей точки «${item.pointName}»`}
            tabIndex={0}
          >
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
        {pinned ? (
          <div className="tooltip-pinned-footer">
            <span>Карточка закреплена · список можно прокручивать</span>
            {editable && onEdit && (
              <button
                type="button"
                className="tooltip-edit-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil size={14} />
                Редактировать
              </button>
            )}
          </div>
        ) : (
          <span className="tooltip-pin-hint">Нажмите на метку, чтобы закрепить карточку</span>
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

function OfflineMapLayers({ mode }: { mode: MapLayerMode }) {
  const nativeZoom = mode === 'overview'
    ? { minimum: 0, maximum: 0 }
    : mode === 'detail'
      ? { minimum: 1, maximum: 2 }
      : mode === 'maximum'
        ? { minimum: 3, maximum: 3 }
        : { minimum: 0, maximum: 3 };

  return (
    <>
      <TileLayer
        key={mode}
        url="/maps/tiles/{z}/{x}/{y}.webp"
        bounds={MAP_BOUNDS}
        tileSize={512}
        minNativeZoom={nativeZoom.minimum}
        maxNativeZoom={nativeZoom.maximum}
        minZoom={-4}
        maxZoom={4}
        noWrap
        keepBuffer={mode === 'maximum' ? 1 : 2}
        updateWhenZooming
        updateWhenIdle
        className={`offline-map-tiles layer-mode-${mode}`}
      />
      <MapLabelsLayer mode={mode} />
    </>
  );
}

function MapLayerControl({
  mode,
  onChange,
  frontline,
  frontlineVisible,
  frontlineLoading,
  frontlineError,
  isAdmin,
  canEditFrontline,
  frontlineEditing,
  onToggleFrontline,
  onEditFrontline,
  onResetFrontline,
}: {
  mode: MapLayerMode;
  onChange: (mode: MapLayerMode) => void;
  frontline: FrontlineSnapshot | null;
  frontlineVisible: boolean;
  frontlineLoading: boolean;
  frontlineError: string;
  isAdmin: boolean;
  canEditFrontline: boolean;
  frontlineEditing: boolean;
  onToggleFrontline: () => void;
  onEditFrontline: () => void;
  onResetFrontline: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = MAP_LAYER_OPTIONS.find((option) => option.id === mode) ?? MAP_LAYER_OPTIONS[0];
  const frontlineStatus = frontlineLoading
    ? 'Загрузка локальных данных…'
    : frontline
      ? `${frontline.custom ? 'Изменена администратором · основа' : 'Снимок'} ${formatFrontlineDate(frontline.dataDate)}`
      : frontlineError || 'Данные отсутствуют';

  return (
    <div
      className={`map-layer-control leaflet-control ${open ? 'is-open' : ''}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        className="map-layer-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Настроить слои карты"
      >
        <Layers3 size={17} />
        <span>
          <small>Слои карты</small>
          <strong>{selected.label}{frontlineVisible ? ' · ЛБС' : ''}</strong>
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="map-layer-menu" role="dialog" aria-label="Слои карты">
          <div className="map-layer-menu-title">
            <strong>Детализация</strong>
            <span>Не зависит от приближения</span>
          </div>
          {MAP_LAYER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={mode === option.id ? 'selected' : ''}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <span className="map-layer-option-check">
                {mode === option.id && <Check size={14} strokeWidth={2.5} />}
              </span>
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </button>
          ))}

          <div className="frontline-layer-section">
            <div className="map-layer-menu-title">
              <strong>Оперативные слои</strong>
              <span>Отдельное включение</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={frontlineVisible}
              className={`frontline-layer-toggle ${frontlineVisible ? 'selected' : ''}`}
              onClick={onToggleFrontline}
              disabled={!frontline || frontlineEditing}
            >
              <span className="map-layer-option-check">
                {frontlineVisible && <Check size={14} strokeWidth={2.5} />}
              </span>
              <span>
                <strong>Линия боевого соприкосновения</strong>
                <small>{frontlineStatus}</small>
              </span>
            </button>
            {frontline && (
              <p className="frontline-layer-notice">
                <span>{frontline.notice}</span>
                <small>Источник: {frontline.sourceName}</small>
              </p>
            )}
            {isAdmin && (
              <div className="frontline-layer-actions">
                <button
                  type="button"
                  onClick={() => {
                    onEditFrontline();
                    setOpen(false);
                  }}
                  disabled={!canEditFrontline || !frontline}
                >
                  <Pencil size={13} />
                  {frontlineEditing ? 'Редактируется' : 'Редактировать линию'}
                </button>
                {frontline?.custom && (
                  <button
                    type="button"
                    className="frontline-reset-button"
                    onClick={onResetFrontline}
                    disabled={frontlineEditing}
                    title="Удалить ручные изменения и вернуть исходный снимок"
                  >
                    <RotateCcw size={13} />
                    Исходная
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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

function FrontlineLayer({
  segments,
  visible,
  editing,
  activeSegmentIndex,
  selectedVertex,
  onSelectSegment,
  onSelectVertex,
  onMoveVertex,
}: {
  segments: RoutePoint[][];
  visible: boolean;
  editing: boolean;
  activeSegmentIndex: number;
  selectedVertex: FrontlineVertexSelection | null;
  onSelectSegment: (index: number) => void;
  onSelectVertex: (selection: FrontlineVertexSelection) => void;
  onMoveVertex: (selection: FrontlineVertexSelection, point: RoutePoint) => void;
}) {
  if (!visible) return null;

  return (
    <>
      <Pane name="frontline" style={{ zIndex: 420, pointerEvents: 'none' }}>
        {segments.map((segment, segmentIndex) => (
          segment.length >= 2 && (
            <Polyline
              key={`frontline-outline-${segmentIndex}`}
              positions={routePositions(segment)}
              interactive={false}
              pathOptions={{
                color: '#ffffff',
                weight: editing && segmentIndex === activeSegmentIndex ? 9 : 8,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          )
        ))}
        {segments.map((segment, segmentIndex) => (
          segment.length >= 2 && (
            <Polyline
              key={`frontline-${segmentIndex}`}
              positions={routePositions(segment)}
              interactive={editing}
              eventHandlers={editing ? {
                click(event) {
                  L.DomEvent.stopPropagation(event.originalEvent);
                  onSelectSegment(segmentIndex);
                },
              } : undefined}
              pathOptions={{
                color: segmentIndex === activeSegmentIndex && editing ? '#b41f2d' : '#cf3441',
                weight: segmentIndex === activeSegmentIndex && editing ? 6 : 5,
                opacity: 0.96,
                dashArray: editing && segmentIndex === activeSegmentIndex ? undefined : '13 8',
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          )
        ))}
      </Pane>
      {editing && (
        <Pane name="frontline-editor" style={{ zIndex: 640 }}>
          {(segments[activeSegmentIndex] ?? []).map((point, pointIndex) => {
            const selection = { segmentIndex: activeSegmentIndex, pointIndex };
            const selected = selectedVertex?.segmentIndex === activeSegmentIndex
              && selectedVertex.pointIndex === pointIndex;
            return (
              <Marker
                key={`frontline-node-${activeSegmentIndex}-${pointIndex}`}
                position={[point.lat, point.lng]}
                icon={selected ? FRONTLINE_VERTEX_SELECTED_ICON : FRONTLINE_VERTEX_ICON}
                draggable
                riseOnHover
                zIndexOffset={160}
                eventHandlers={{
                  click(event) {
                    L.DomEvent.stopPropagation(event.originalEvent);
                    onSelectVertex(selection);
                  },
                  dragstart() {
                    onSelectVertex(selection);
                  },
                  dragend(event) {
                    const position = (event.target as L.Marker).getLatLng();
                    onMoveVertex(selection, {
                      lat: Math.min(MAP_HEIGHT, Math.max(0, position.lat)),
                      lng: Math.min(MAP_WIDTH, Math.max(0, position.lng)),
                    });
                  },
                }}
              />
            );
          })}
        </Pane>
      )}
    </>
  );
}

function FrontlineMapClickHandler({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: (point: RoutePoint) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onClick({
        lat: Math.min(MAP_HEIGHT, Math.max(0, event.latlng.lat)),
        lng: Math.min(MAP_WIDTH, Math.max(0, event.latlng.lng)),
      });
    },
  });
  return null;
}

function frontlineInsertionIndex(segment: RoutePoint[], point: RoutePoint): number {
  if (segment.length < 2) return segment.length;
  let nearestIndex = 1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < segment.length - 1; index += 1) {
    const start = segment[index];
    const end = segment[index + 1];
    const horizontal = end.lng - start.lng;
    const vertical = end.lat - start.lat;
    const lengthSquared = horizontal * horizontal + vertical * vertical;
    const factor = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1,
        ((point.lng - start.lng) * horizontal + (point.lat - start.lat) * vertical) / lengthSquared,
      ));
    const projectedLng = start.lng + factor * horizontal;
    const projectedLat = start.lat + factor * vertical;
    const distance = (point.lng - projectedLng) ** 2 + (point.lat - projectedLat) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index + 1;
    }
  }
  return nearestIndex;
}

function FrontlineEditorPanel({
  segmentCount,
  activeSegmentIndex,
  activePointCount,
  selectedVertex,
  addPointMode,
  canSave,
  onSelectSegment,
  onToggleAddPoint,
  onNewSegment,
  onDeleteVertex,
  onDeleteSegment,
  onCancel,
  onSave,
}: {
  segmentCount: number;
  activeSegmentIndex: number;
  activePointCount: number;
  selectedVertex: FrontlineVertexSelection | null;
  addPointMode: boolean;
  canSave: boolean;
  onSelectSegment: (index: number) => void;
  onToggleAddPoint: () => void;
  onNewSegment: () => void;
  onDeleteVertex: () => void;
  onDeleteSegment: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="frontline-editor-panel" role="dialog" aria-label="Редактирование линии боевого соприкосновения">
      <div className="frontline-editor-heading">
        <Route size={19} />
        <span>
          <strong>Редактирование линии</strong>
          <small>
            Перетаскивайте узлы. Режим добавления вставляет новый узел в ближайший отрезок.
          </small>
        </span>
      </div>
      <label className="frontline-segment-select">
        <span>Участок</span>
        <select
          value={activeSegmentIndex}
          onChange={(event) => onSelectSegment(Number(event.target.value))}
        >
          {Array.from({ length: segmentCount }, (_, index) => (
            <option key={index} value={index}>№ {index + 1} · {index === activeSegmentIndex ? `${activePointCount} узлов` : 'выбрать'}</option>
          ))}
        </select>
      </label>
      <div className="frontline-editor-actions">
        <button
          type="button"
          className={addPointMode ? 'is-active' : ''}
          onClick={onToggleAddPoint}
          title="После включения нажмите в нужном месте карты"
        >
          <Plus size={15} />
          {addPointMode ? 'Нажмите на карту' : 'Добавить узел'}
        </button>
        <button type="button" onClick={onNewSegment}>
          <Route size={15} /> Новый участок
        </button>
        <button type="button" onClick={onDeleteVertex} disabled={!selectedVertex}>
          <Trash2 size={15} /> Узел
        </button>
        <button type="button" onClick={onDeleteSegment} disabled={segmentCount <= 1}>
          <Trash2 size={15} /> Участок
        </button>
        <button type="button" className="frontline-cancel" onClick={onCancel}>
          <X size={15} /> Отмена
        </button>
        <button type="button" className="frontline-save" onClick={onSave} disabled={!canSave}>
          <Save size={15} /> Сохранить
        </button>
      </div>
    </div>
  );
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
  const markerRef = useRef<L.Marker | null>(null);
  const icon = useMemo(
    () => markerIcon(item, focused, locationName),
    [item, focused, locationName],
  );

  const eventHandlers = useMemo<LeafletEventHandlerFnMap>(
    () => ({
      click(event) {
        if (item.kind === 'person') {
          const marker = event.target as L.Marker;
          L.DomEvent.stopPropagation(event.originalEvent);
          marker.closeTooltip();
          // Popup also has Leaflet's native click handler. Re-check after all
          // handlers finish so a point click always leaves the card pinned.
          window.setTimeout(() => {
            if (!marker.isPopupOpen()) marker.openPopup();
          }, 0);
          return;
        }
        if (editable) {
          L.DomEvent.stopPropagation(event.originalEvent);
          onEdit(item);
        }
      },
      popupopen(event) {
        event.target.closeTooltip();
      },
      mouseover(event) {
        if (!event.target.isPopupOpen()) event.target.openTooltip();
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
      ref={markerRef}
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
      {item.kind === 'person' && (
        <Popup
          className="object-popup"
          offset={[0, -46]}
          minWidth={260}
          maxWidth={390}
          autoPan
          autoPanPadding={[24, 24]}
          keepInView
          closeButton
          autoClose
        >
          <ObjectTooltip
            item={item}
            locationName={locationName}
            pinned
            editable={editable}
            onEdit={() => {
              markerRef.current?.closePopup();
              onEdit(item);
            }}
          />
        </Popup>
      )}
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
  const [layerMode, setLayerMode] = useMapLayerMode();
  const frontline = useFrontlineLayer();
  const [frontlineEditing, setFrontlineEditing] = useState(false);
  const [frontlineDraft, setFrontlineDraft] = useState<RoutePoint[][]>([]);
  const [activeFrontlineSegment, setActiveFrontlineSegment] = useState(0);
  const [selectedFrontlineVertex, setSelectedFrontlineVertex] = useState<FrontlineVertexSelection | null>(null);
  const [frontlineAddPointMode, setFrontlineAddPointMode] = useState(false);
  const canEditFrontline = isAdmin && placement === null && routeDraft === null;
  const displayedFrontline = frontlineEditing
    ? frontlineDraft
    : frontline.snapshot?.segments ?? [];

  const cancelFrontlineEditing = useCallback(() => {
    setFrontlineEditing(false);
    setFrontlineDraft([]);
    setSelectedFrontlineVertex(null);
    setFrontlineAddPointMode(false);
  }, []);

  useEffect(() => {
    if (frontlineEditing && !canEditFrontline) cancelFrontlineEditing();
  }, [canEditFrontline, cancelFrontlineEditing, frontlineEditing]);

  function startFrontlineEditing() {
    if (!canEditFrontline || !frontline.snapshot) return;
    setFrontlineDraft(cloneFrontlineSegments(frontline.snapshot.segments));
    setActiveFrontlineSegment(0);
    setSelectedFrontlineVertex(null);
    setFrontlineAddPointMode(false);
    setFrontlineEditing(true);
    frontline.setVisible(true);
  }

  function selectFrontlineSegment(index: number) {
    setActiveFrontlineSegment(Math.min(Math.max(0, index), Math.max(0, frontlineDraft.length - 1)));
    setSelectedFrontlineVertex(null);
  }

  function moveFrontlineVertex(selection: FrontlineVertexSelection, point: RoutePoint) {
    setFrontlineDraft((current) => current.map((segment, segmentIndex) => (
      segmentIndex === selection.segmentIndex
        ? segment.map((entry, pointIndex) => (pointIndex === selection.pointIndex ? point : entry))
        : segment
    )));
    setSelectedFrontlineVertex(selection);
  }

  function handleFrontlineMapClick(point: RoutePoint) {
    if (!frontlineAddPointMode) {
      setSelectedFrontlineVertex(null);
      return;
    }
    const segment = frontlineDraft[activeFrontlineSegment] ?? [];
    const pointIndex = frontlineInsertionIndex(segment, point);
    setFrontlineDraft((current) => {
      const next = current.map((entry) => [...entry]);
      if (!next[activeFrontlineSegment]) next[activeFrontlineSegment] = [];
      next[activeFrontlineSegment].splice(pointIndex, 0, point);
      return next;
    });
    setSelectedFrontlineVertex({ segmentIndex: activeFrontlineSegment, pointIndex });
  }

  function addFrontlineSegment() {
    setActiveFrontlineSegment(frontlineDraft.length);
    setFrontlineDraft((current) => [...current, []]);
    setSelectedFrontlineVertex(null);
    setFrontlineAddPointMode(true);
  }

  function deleteSelectedFrontlineVertex() {
    if (!selectedFrontlineVertex) return;
    setFrontlineDraft((current) => current.map((segment, segmentIndex) => (
      segmentIndex === selectedFrontlineVertex.segmentIndex
        ? segment.filter((_, pointIndex) => pointIndex !== selectedFrontlineVertex.pointIndex)
        : segment
    )));
    setSelectedFrontlineVertex(null);
  }

  function deleteActiveFrontlineSegment() {
    if (frontlineDraft.length <= 1) return;
    setFrontlineDraft((current) => current.filter((_, index) => index !== activeFrontlineSegment));
    setActiveFrontlineSegment((current) => Math.max(0, Math.min(current, frontlineDraft.length - 2)));
    setSelectedFrontlineVertex(null);
  }

  function saveFrontlineEditing() {
    const prepared = frontlineDraft.filter((segment) => segment.length >= 2);
    if (prepared.length === 0) return;
    frontline.saveCustom(prepared);
    cancelFrontlineEditing();
  }

  function resetFrontline() {
    if (!window.confirm('Удалить ручные изменения и вернуть исходную линию из комплекта ДУС?')) return;
    frontline.resetCustom();
  }

  return (
    <div className={`map-wrap ${placement ? 'is-placing' : ''} ${routeDraft ? 'is-routing' : ''} ${frontlineEditing ? 'is-editing-frontline' : ''}`}>
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
        <OfflineMapLayers mode={layerMode} />
        <FrontlineLayer
          segments={displayedFrontline}
          visible={frontline.visible || frontlineEditing}
          editing={frontlineEditing}
          activeSegmentIndex={activeFrontlineSegment}
          selectedVertex={selectedFrontlineVertex}
          onSelectSegment={selectFrontlineSegment}
          onSelectVertex={(selection) => {
            setActiveFrontlineSegment(selection.segmentIndex);
            setSelectedFrontlineVertex(selection);
          }}
          onMoveVertex={moveFrontlineVertex}
        />
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
        <FrontlineMapClickHandler enabled={frontlineEditing} onClick={handleFrontlineMapClick} />
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
              && !frontlineEditing
              && (item.kind === 'vehicle' || excelConnected)
            }
            draggable={
              isAdmin
              && placement === null
              && routeDraft === null
              && !frontlineEditing
              && (item.kind === 'vehicle' || excelConnected)
              && !(item.kind === 'vehicle' && item.status === 'moving' && item.route.length > 1)
            }
            mapClickMode={placement !== null || routeDraft !== null || frontlineEditing}
            onEdit={onEdit}
            onMove={onMove}
          />
        ))}
        <MapControls />
        <MapLayerControl
          mode={layerMode}
          onChange={setLayerMode}
          frontline={frontline.snapshot}
          frontlineVisible={frontline.visible}
          frontlineLoading={frontline.loading}
          frontlineError={frontline.error}
          isAdmin={isAdmin}
          canEditFrontline={canEditFrontline && !frontlineEditing}
          frontlineEditing={frontlineEditing}
          onToggleFrontline={() => frontline.setVisible(!frontline.visible)}
          onEditFrontline={startFrontlineEditing}
          onResetFrontline={resetFrontline}
        />
      </MapContainer>

      {frontlineEditing && (
        <FrontlineEditorPanel
          segmentCount={frontlineDraft.length}
          activeSegmentIndex={activeFrontlineSegment}
          activePointCount={frontlineDraft[activeFrontlineSegment]?.length ?? 0}
          selectedVertex={selectedFrontlineVertex}
          addPointMode={frontlineAddPointMode}
          canSave={frontlineDraft.some((segment) => segment.length >= 2)}
          onSelectSegment={selectFrontlineSegment}
          onToggleAddPoint={() => setFrontlineAddPointMode((current) => !current)}
          onNewSegment={addFrontlineSegment}
          onDeleteVertex={deleteSelectedFrontlineVertex}
          onDeleteSegment={deleteActiveFrontlineSegment}
          onCancel={cancelFrontlineEditing}
          onSave={saveFrontlineEditing}
        />
      )}

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
        {(frontline.visible || frontlineEditing) && (
          <span title={frontline.snapshot?.notice}>
            <i className="legend-line frontline" /> ЛБС · {formatFrontlineDate(frontline.snapshot?.dataDate ?? '')}
          </span>
        )}
      </div>
    </div>
  );
}
