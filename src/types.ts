export type ItemKind = 'person' | 'vehicle';
export type VehicleStatus = 'moving' | 'parked' | 'service';

interface BaseMapItem {
  id: string;
  kind: ItemKind;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonPoint extends BaseMapItem {
  kind: 'person';
  firstName: string;
  lastName: string;
  pointName: string;
}

export interface VehiclePoint extends BaseMapItem {
  kind: 'vehicle';
  name: string;
  driver: string;
  status: VehicleStatus;
  heading: number;
}

export type MapItem = PersonPoint | VehiclePoint;
export type ItemFilter = 'all' | ItemKind;

export interface EditorState {
  mode: 'create' | 'edit';
  item: MapItem;
}
