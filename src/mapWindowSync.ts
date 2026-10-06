import type { ItemKind, MapItem, RoutePoint } from './types';

export const MAP_WINDOW_CHANNEL = 'dus-detached-map-v1';
export const MAP_WINDOW_QUERY = 'mapWindow';
export const MAP_WINDOW_NAME = 'dus-interactive-map';

export interface DetachedMapState {
  items: MapItem[];
  focusedId: string | null;
  placement: ItemKind | null;
  routeDraft: RoutePoint[] | null;
  routeVehicleId: string | null;
  isAdmin: boolean;
  excelConnected: boolean;
}

export type MapWindowMessage =
  | { type: 'controller-state'; state: DetachedMapState }
  | { type: 'controller-heartbeat' }
  | { type: 'controller-closing' }
  | { type: 'detached-ready' }
  | { type: 'detached-heartbeat' }
  | { type: 'detached-closing' }
  | { type: 'request-state' }
  | { type: 'focus-controller' }
  | { type: 'map-place'; lat: number; lng: number }
  | { type: 'map-edit'; id: string }
  | { type: 'map-move'; id: string; lat: number; lng: number }
  | { type: 'map-focus'; id: string }
  | { type: 'route-undo' }
  | { type: 'route-cancel' }
  | { type: 'route-start' };

export function isMapWindowMessage(value: unknown): value is MapWindowMessage {
  return Boolean(
    value
    && typeof value === 'object'
    && 'type' in value
    && typeof (value as { type?: unknown }).type === 'string',
  );
}
