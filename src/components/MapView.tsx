import { useEffect, useMemo, useState } from 'react';
import L, { type LeafletEventHandlerFnMap } from 'leaflet';
import {
  ImageOverlay,
  MapContainer,
  Marker,
  Pane,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Fullscreen, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data';
import type { ItemKind, MapItem, PersonPoint, VehiclePoint } from '../types';

const MAP_BOUNDS = L.latLngBounds(
  [0, 0],
  [MAP_HEIGHT, MAP_WIDTH],
);

interface MapViewProps {
  items: MapItem[];
  focusedItem: MapItem | null;
  placement: ItemKind | null;
  isAdmin: boolean;
  excelConnected: boolean;
  onPlace: (lat: number, lng: number) => void;
  onEdit: (item: MapItem) => void;
  onMove: (id: string, lat: number, lng: number) => void;
}

interface MapPlace {
  name: string;
  x: number;
  y: number;
  population: number;
  capital: boolean;
  rank: number;
  minZoom: number;
}

interface PlacesPayload {
  places: MapPlace[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function personInitials(item: PersonPoint): string {
  const words = item.pointName.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word.charAt(0)).join('');
  return escapeHtml(initials.toLocaleUpperCase('ru-RU') || '•');
}

function placeIcon(place: MapPlace): L.DivIcon {
  const sizeClass = place.capital || place.population >= 900_000
    ? 'major'
    : place.population >= 250_000
      ? 'medium'
      : 'small';
  const sideClass = place.x > MAP_WIDTH - 120 ? ' align-left' : '';

  return L.divIcon({
    className: 'leaflet-place-icon',
    iconSize: [1, 1],
    iconAnchor: [0, 0],
    html: `
      <span class="map-place ${sizeClass}${sideClass}">
        <i></i><span>${escapeHtml(place.name)}</span>
      </span>
    `,
  });
}

function minimumPopulationForZoom(zoom: number): number {
  if (zoom < 0) return 700_000;
  if (zoom < 0.75) return 300_000;
  if (zoom < 1.5) return 100_000;
  if (zoom < 2.4) return 35_000;
  return 0;
}

function markerIcon(item: MapItem, focused: boolean): L.DivIcon {
  const focusClass = focused ? ' is-focused' : '';

  if (item.kind === 'person') {
    return L.divIcon({
      className: 'leaflet-object-icon',
      iconSize: [92, 92],
      iconAnchor: [46, 46],
      tooltipAnchor: [0, -31],
      html: `
        <div class="object-marker person-object${focusClass}">
          <span class="marker-proximity"></span>
          <span class="person-pin">
            <span class="person-pin-core">${personInitials(item)}</span>
          </span>
          <span class="marker-caption">${escapeHtml(item.pointName || 'Новая точка')}</span>
        </div>
      `,
    });
  }

  const statusClass = escapeHtml(item.status);
  return L.divIcon({
    className: 'leaflet-object-icon',
    iconSize: [96, 96],
    iconAnchor: [48, 48],
    tooltipAnchor: [0, -33],
    html: `
      <div class="object-marker vehicle-object ${statusClass}${focusClass}">
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

function ObjectTooltip({ item }: { item: MapItem }) {
  if (item.kind === 'person') {
    return (
      <div className="map-tooltip-card point-personnel-tooltip">
        <div className="tooltip-topline">
          <span className="tooltip-type person">Точка · {item.personnel.length} сотр.</span>
          <span className="tooltip-live"><i /> {item.sheetName ? 'Excel' : 'Локально'}</span>
        </div>
        <strong className="tooltip-title">{item.pointName}</strong>
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
          <tr><th>Статус</th><td>{vehicleStatus(item.status)}</td></tr>
          <tr><th>Курс</th><td>{Math.round(item.heading)}°</td></tr>
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
  const fitZoom = map.getBoundsZoom(MAP_BOUNDS, false, L.point(0, 0));
  map.setMinZoom(fitZoom);
  map.setMaxBounds(MAP_BOUNDS);

  if (fit || map.getZoom() < fitZoom) {
    map.fitBounds(MAP_BOUNDS, { padding: [0, 0], animate: false });
  } else {
    map.panInsideBounds(MAP_BOUNDS, { animate: false });
  }
}

function OfflineMapLayers() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [places, setPlaces] = useState<MapPlace[]>([]);

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  useEffect(() => {
    let active = true;
    fetch('/maps/places.json')
      .then((response) => {
        if (!response.ok) throw new Error('Не удалось загрузить названия населённых пунктов');
        return response.json() as Promise<PlacesPayload>;
      })
      .then((payload) => {
        if (active) setPlaces(payload.places);
      })
      .catch(() => {
        if (active) setPlaces([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const visiblePlaces = useMemo(() => {
    const minimumPopulation = minimumPopulationForZoom(zoom);
    return places.filter((place) => place.capital || place.population >= minimumPopulation);
  }, [places, zoom]);

  const detailed = zoom >= 1;

  return (
    <>
      <ImageOverlay
        url="/maps/real-region.svg"
        bounds={MAP_BOUNDS}
        opacity={detailed ? 0 : 1}
      />
      <ImageOverlay
        url="/maps/real-region-detail.svg"
        bounds={MAP_BOUNDS}
        opacity={detailed ? 1 : 0}
      />
      <Pane name="place-labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
        {visiblePlaces.map((place) => (
          <Marker
            key={`${place.name}-${place.x}-${place.y}`}
            position={[MAP_HEIGHT - place.y, place.x]}
            icon={placeIcon(place)}
            interactive={false}
            keyboard={false}
          />
        ))}
      </Pane>
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

function FocusController({ item }: { item: MapItem | null }) {
  const map = useMap();

  useEffect(() => {
    if (!item) return;
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

function MapObject({
  item,
  focused,
  draggable,
  onEdit,
  onMove,
}: {
  item: MapItem;
  focused: boolean;
  draggable: boolean;
  onEdit: (item: MapItem) => void;
  onMove: (id: string, lat: number, lng: number) => void;
}) {
  const icon = useMemo(() => markerIcon(item, focused), [item, focused]);

  const eventHandlers = useMemo<LeafletEventHandlerFnMap>(
    () => ({
      click(event) {
        if (draggable) {
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
    [draggable, item, onEdit, onMove],
  );

  return (
    <Marker
      position={[item.lat, item.lng]}
      icon={icon}
      draggable={draggable}
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
        <ObjectTooltip item={item} />
      </Tooltip>
    </Marker>
  );
}

export function MapView({
  items,
  focusedItem,
  placement,
  isAdmin,
  excelConnected,
  onPlace,
  onEdit,
  onMove,
}: MapViewProps) {
  return (
    <div className={`map-wrap ${placement ? 'is-placing' : ''}`}>
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
        wheelPxPerZoomLevel={80}
        zoomControl={false}
        attributionControl={false}
        preferCanvas={false}
      >
        <OfflineMapLayers />
        <FitMapOnStart />
        <FocusController item={focusedItem} />
        <PlacementHandler enabled={placement !== null} onPlace={onPlace} />
        {items.map((item) => (
          <MapObject
            key={item.id}
            item={item}
            focused={item.id === focusedItem?.id}
            draggable={
              isAdmin &&
              placement === null &&
              (item.kind === 'vehicle' || excelConnected)
            }
            onEdit={onEdit}
            onMove={onMove}
          />
        ))}
        <MapControls />
      </MapContainer>

      <div className="map-demo-label">
        <span>Расширенная карта</span>
        <small>детализация при приближении · офлайн</small>
      </div>
      <div className="map-legend" aria-label="Условные обозначения">
        <span><i className="legend-dot person" /> Точка</span>
        <span><i className="legend-dot vehicle" /> Машина</span>
      </div>
    </div>
  );
}
