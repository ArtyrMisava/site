import { useEffect, useMemo } from 'react';
import L, {
  type LeafletEventHandlerFnMap,
  type LatLngBoundsExpression,
} from 'leaflet';
import {
  ImageOverlay,
  MapContainer,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data';
import type { ItemKind, MapItem, PersonPoint, VehiclePoint } from '../types';

const MAP_BOUNDS: LatLngBoundsExpression = [
  [0, 0],
  [MAP_HEIGHT, MAP_WIDTH],
];

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

function FitMapOnStart() {
  const map = useMap();

  useEffect(() => {
    map.fitBounds(MAP_BOUNDS, { padding: [18, 18], animate: false });

    // На узком экране полная широкая схема оставляет большие пустые поля.
    // Заполняем карту по высоте, сохраняя возможность показать весь город
    // отдельной кнопкой в панели масштаба.
    const viewport = map.getSize();
    if (viewport.x < 700) {
      const verticalFillZoom = Math.log2(
        Math.max(1, viewport.y - 40) / MAP_HEIGHT,
      );
      map.setZoom(Math.max(map.getZoom(), verticalFillZoom), {
        animate: false,
      });
    }

    map.setMaxBounds([
      [-180, -260],
      [MAP_HEIGHT + 180, MAP_WIDTH + 260],
    ]);
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

  return (
    <div className="map-controls leaflet-control" onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => map.zoomIn()} aria-label="Приблизить карту">
        <Plus size={18} />
      </button>
      <button type="button" onClick={() => map.zoomOut()} aria-label="Отдалить карту">
        <Minus size={18} />
      </button>
      <button
        type="button"
        onClick={() => map.fitBounds(MAP_BOUNDS, { padding: [18, 18] })}
        aria-label="Показать всю карту"
      >
        <Maximize2 size={17} />
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
        minZoom={-1.5}
        maxZoom={2.5}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={90}
        zoomControl={false}
        attributionControl={false}
        preferCanvas={false}
      >
        <ImageOverlay url="/maps/real-region.svg" bounds={MAP_BOUNDS} />
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
        <span>Реальная карта</span>
        <small>Natural Earth · полностью офлайн</small>
      </div>
      <div className="map-legend" aria-label="Условные обозначения">
        <span><i className="legend-dot person" /> Точка</span>
        <span><i className="legend-dot vehicle" /> Машина</span>
      </div>
    </div>
  );
}
