import type { MapItem, PersonPoint, VehiclePoint } from './types';

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1000;
export const STORAGE_KEY = 'lokus-map-items-v1';

const now = '2026-10-04T09:00:00.000Z';

export const seedItems: MapItem[] = [
  {
    id: 'point-office',
    kind: 'person',
    firstName: 'Иван',
    lastName: 'Петров',
    pointName: 'Центральный офис',
    lat: 530,
    lng: 780,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'point-warehouse',
    kind: 'person',
    firstName: 'Анна',
    lastName: 'Соколова',
    pointName: 'Склад № 2',
    lat: 700,
    lng: 1270,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'point-gate',
    kind: 'person',
    firstName: 'Михаил',
    lastName: 'Орлов',
    pointName: 'Западное КПП',
    lat: 310,
    lng: 280,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'vehicle-am17',
    kind: 'vehicle',
    name: 'АМ-17',
    driver: 'Сергей Волков',
    status: 'moving',
    heading: 48,
    lat: 360,
    lng: 950,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'vehicle-van04',
    kind: 'vehicle',
    name: 'Фургон 04',
    driver: 'Алексей Морозов',
    status: 'parked',
    heading: 180,
    lat: 280,
    lng: 1360,
    createdAt: now,
    updatedAt: now,
  },
];

export function loadItems(): MapItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedItems;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return seedItems;
    return parsed as MapItem[];
  } catch {
    return seedItems;
  }
}

export function makeDraft(kind: 'person', lat: number, lng: number): PersonPoint;
export function makeDraft(kind: 'vehicle', lat: number, lng: number): VehiclePoint;
export function makeDraft(kind: 'person' | 'vehicle', lat: number, lng: number): MapItem;
export function makeDraft(kind: 'person' | 'vehicle', lat: number, lng: number): MapItem {
  const timestamp = new Date().toISOString();
  const base = {
    id: crypto.randomUUID?.() ?? `item-${Date.now()}`,
    lat,
    lng,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (kind === 'person') {
    return {
      ...base,
      kind,
      firstName: '',
      lastName: '',
      pointName: '',
    };
  }

  return {
    ...base,
    kind,
    name: '',
    driver: '',
    status: 'parked',
    heading: 0,
  };
}

export function itemTitle(item: MapItem): string {
  return item.kind === 'person'
    ? `${item.firstName} ${item.lastName}`.trim() || 'Новая точка'
    : item.name || 'Новая машина';
}

export function itemSubtitle(item: MapItem): string {
  return item.kind === 'person'
    ? item.pointName || 'Название не указано'
    : item.driver || 'Водитель не указан';
}
