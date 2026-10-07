import type { ItemKind, MapItem, RoutePoint } from './types';

export const MAP_WINDOW_QUERY = 'mapWindow';
export const MAP_WINDOW_NAME = 'dus-interactive-map';
export const MAP_WINDOW_CHANNEL = 'dus-detached-map-v1';
export const MAP_VIEW_LINK_STORAGE_KEY = 'dus-map-view-link-v1';

export interface MapViewport {
  center: {
    lat: number;
    lng: number;
  };
  zoom: number;
}

export interface DetachedMapState {
  items: MapItem[];
  focusedId: string | null;
  placement: ItemKind | null;
  routeDraft: RoutePoint[] | null;
  routeVehicleId: string | null;
  isAdmin: boolean;
  excelConnected: boolean;
  viewLinked: boolean;
  viewport: MapViewport | null;
}

export type MapWindowMessage =
  | { type: 'detached-ready' }
  | { type: 'detached-closing' }
  | { type: 'detached-heartbeat' }
  | { type: 'controller-heartbeat' }
  | { type: 'controller-closing' }
  | { type: 'request-state' }
  | { type: 'controller-state'; state: DetachedMapState }
  | { type: 'map-view'; source: 'controller' | 'detached'; viewport: MapViewport }
  | { type: 'view-link-set'; linked: boolean }
  | { type: 'map-place'; lat: number; lng: number }
  | { type: 'map-edit'; id: string }
  | { type: 'map-move'; id: string; lat: number; lng: number }
  | { type: 'map-focus'; id: string }
  | { type: 'route-undo' }
  | { type: 'route-cancel' }
  | { type: 'route-start' }
  | { type: 'focus-controller' };

function isMapViewport(value: unknown): value is MapViewport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MapViewport>;
  if (!candidate.center || typeof candidate.center !== 'object') return false;
  const center = candidate.center as Partial<MapViewport['center']>;
  return Number.isFinite(center.lat)
    && Number.isFinite(center.lng)
    && Number.isFinite(candidate.zoom);
}

export function isMapWindowMessage(value: unknown): value is MapWindowMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const message = value as Partial<MapWindowMessage> & Record<string, unknown>;
  if (typeof message.type !== 'string') return false;

  switch (message.type) {
    case 'controller-state':
      return Boolean(message.state && typeof message.state === 'object');
    case 'map-view':
      return (message.source === 'controller' || message.source === 'detached')
        && isMapViewport(message.viewport);
    case 'view-link-set':
      return typeof message.linked === 'boolean';
    case 'map-place':
      return Number.isFinite(message.lat) && Number.isFinite(message.lng);
    case 'map-edit':
    case 'map-focus':
      return typeof message.id === 'string';
    case 'map-move':
      return typeof message.id === 'string'
        && Number.isFinite(message.lat)
        && Number.isFinite(message.lng);
    case 'detached-ready':
    case 'detached-closing':
    case 'detached-heartbeat':
    case 'controller-heartbeat':
    case 'controller-closing':
    case 'request-state':
    case 'route-undo':
    case 'route-cancel':
    case 'route-start':
    case 'focus-controller':
      return true;
    default:
      return false;
  }
}
