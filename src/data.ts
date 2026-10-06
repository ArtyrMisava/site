import type {
  MapItem,
  PersonnelEntry,
  PersonPoint,
  RoutePoint,
  VehiclePoint,
  VehicleStatus,
} from './types';

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1000;
export const STORAGE_KEY = 'lokus-map-items-v1';
export const MAP_COORDINATE_VERSION = 2;
export const MAP_GEOGRAPHIC_BOUNDS = { west: 14, south: 38, east: 60, north: 61 } as const;

const COORDINATE_VERSION_KEY = 'dus-map-coordinate-version';
const LEGACY_BOUNDS = { west: 21.5, south: 41.5, east: 49, north: 54 } as const;

function mercatorY(latitude: number): number {
  const radians = Math.min(85, Math.max(-85, latitude)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function geographicLatitude(projectedY: number): number {
  return (2 * Math.atan(Math.exp(projectedY)) - Math.PI / 2) * 180 / Math.PI;
}

export function mapLatitudeToGeographicLatitude(lat: number): number {
  const south = mercatorY(MAP_GEOGRAPHIC_BOUNDS.south);
  const north = mercatorY(MAP_GEOGRAPHIC_BOUNDS.north);
  return geographicLatitude(south + (lat / MAP_HEIGHT) * (north - south));
}

export function migrateLegacyMapCoordinates(lat: number, lng: number): RoutePoint {
  const legacySouth = mercatorY(LEGACY_BOUNDS.south);
  const legacyNorth = mercatorY(LEGACY_BOUNDS.north);
  const currentSouth = mercatorY(MAP_GEOGRAPHIC_BOUNDS.south);
  const currentNorth = mercatorY(MAP_GEOGRAPHIC_BOUNDS.north);
  const projectedLatitude = legacySouth + (lat / MAP_HEIGHT) * (legacyNorth - legacySouth);
  const longitude = LEGACY_BOUNDS.west + (lng / MAP_WIDTH) * (LEGACY_BOUNDS.east - LEGACY_BOUNDS.west);
  return {
    lat: Math.min(MAP_HEIGHT, Math.max(0,
      ((projectedLatitude - currentSouth) / (currentNorth - currentSouth)) * MAP_HEIGHT,
    )),
    lng: Math.min(MAP_WIDTH, Math.max(0,
      ((longitude - MAP_GEOGRAPHIC_BOUNDS.west)
        / (MAP_GEOGRAPHIC_BOUNDS.east - MAP_GEOGRAPHIC_BOUNDS.west)) * MAP_WIDTH,
    )),
  };
}

const now = '2026-10-04T09:00:00.000Z';

export const seedItems: MapItem[] = [
  {
    id: 'point-office',
    kind: 'person',
    pointName: 'Центральный офис',
    personnel: [
      { id: 'person-ivan-petrov', fullName: 'Иван Петров', position: 'Руководитель смены' },
    ],
    lat: 398.22,
    lng: 727.17,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'point-warehouse',
    kind: 'person',
    pointName: 'Склад № 2',
    personnel: [
      { id: 'person-anna-sokolova', fullName: 'Анна Соколова', position: 'Кладовщик' },
    ],
    lat: 485.76,
    lng: 1020.11,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'point-gate',
    kind: 'person',
    pointName: 'Западное КПП',
    personnel: [
      { id: 'person-mikhail-orlov', fullName: 'Михаил Орлов', position: 'Дежурный' },
    ],
    lat: 284.93,
    lng: 428.26,
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
    route: [],
    routeSegment: 0,
    routeProgress: 0,
    routeSpeed: 60,
    lat: 310.67,
    lng: 828.8,
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
    route: [],
    routeSegment: 0,
    routeProgress: 0,
    routeSpeed: 60,
    lat: 269.48,
    lng: 1073.91,
    createdAt: now,
    updatedAt: now,
  },
];

function makePersonnelId(index: number): string {
  return crypto.randomUUID?.() ?? `personnel-${Date.now()}-${index}`;
}

function normalizePoint(value: Record<string, unknown>): PersonPoint {
  const timestamp = new Date().toISOString();
  let personnel: PersonnelEntry[] = [];

  if (Array.isArray(value.personnel)) {
    personnel = value.personnel
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const person = entry as Record<string, unknown>;
        const fullName = String(person.fullName ?? '').trim();
        if (!fullName) return null;
        return {
          id: String(person.id ?? makePersonnelId(index)),
          fullName,
          position: String(person.position ?? '').trim(),
        };
      })
      .filter((entry): entry is PersonnelEntry => entry !== null);
  } else {
    // Migration from the first prototype where one marker contained one person.
    const fullName = `${String(value.firstName ?? '').trim()} ${String(value.lastName ?? '').trim()}`.trim();
    if (fullName) {
      personnel = [{ id: makePersonnelId(0), fullName, position: '' }];
    }
  }

  return {
    id: String(value.id ?? crypto.randomUUID?.() ?? `point-${Date.now()}`),
    kind: 'person',
    pointName: String(value.pointName ?? value.sheetName ?? 'Точка').trim() || 'Точка',
    personnel,
    excelId: value.excelId ? String(value.excelId) : undefined,
    sheetName: value.sheetName ? String(value.sheetName) : undefined,
    lat: Number.isFinite(Number(value.lat))
      ? Math.min(MAP_HEIGHT, Math.max(0, Number(value.lat)))
      : MAP_HEIGHT / 2,
    lng: Number.isFinite(Number(value.lng))
      ? Math.min(MAP_WIDTH, Math.max(0, Number(value.lng)))
      : MAP_WIDTH / 2,
    createdAt: String(value.createdAt ?? timestamp),
    updatedAt: String(value.updatedAt ?? timestamp),
  };
}

const VEHICLE_STATUSES: VehicleStatus[] = ['moving', 'parked', 'service'];

function normalizeRoutePoint(value: unknown): RoutePoint | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RoutePoint>;
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return null;
  return {
    lat: Math.min(MAP_HEIGHT, Math.max(0, Number(candidate.lat))),
    lng: Math.min(MAP_WIDTH, Math.max(0, Number(candidate.lng))),
  };
}

function normalizeVehicle(value: Record<string, unknown>): VehiclePoint {
  const route = Array.isArray(value.route)
    ? value.route.map(normalizeRoutePoint).filter((point): point is RoutePoint => point !== null)
    : [];
  const rawSegment = Number(value.routeSegment);
  const rawProgress = Number(value.routeProgress);
  const rawSpeed = Number(value.routeSpeed);
  const status = String(value.status) as VehicleStatus;
  const routeSegment = Math.min(
    Math.max(0, Math.floor(Number.isFinite(rawSegment) ? rawSegment : 0)),
    Math.max(0, route.length - 1),
  );
  const normalizedStatus = VEHICLE_STATUSES.includes(status) ? status : 'parked';

  return {
    id: String(value.id ?? crypto.randomUUID?.() ?? `vehicle-${Date.now()}`),
    kind: 'vehicle',
    name: String(value.name ?? ''),
    driver: String(value.driver ?? ''),
    status: normalizedStatus === 'moving' && route.length > 1 && routeSegment >= route.length - 1
      ? 'parked'
      : normalizedStatus,
    heading: Number.isFinite(Number(value.heading))
      ? ((Number(value.heading) % 360) + 360) % 360
      : 0,
    route,
    routeSegment,
    routeProgress: Math.min(1, Math.max(0, Number.isFinite(rawProgress) ? rawProgress : 0)),
    routeSpeed: Math.min(500, Math.max(1, Number.isFinite(rawSpeed) ? rawSpeed : 60)),
    lat: Number.isFinite(Number(value.lat))
      ? Math.min(MAP_HEIGHT, Math.max(0, Number(value.lat)))
      : MAP_HEIGHT / 2,
    lng: Number.isFinite(Number(value.lng))
      ? Math.min(MAP_WIDTH, Math.max(0, Number(value.lng)))
      : MAP_WIDTH / 2,
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    updatedAt: String(value.updatedAt ?? new Date().toISOString()),
  };
}

function migrateLegacyItemCoordinates(item: MapItem): MapItem {
  const position = migrateLegacyMapCoordinates(item.lat, item.lng);
  if (item.kind === 'person') return { ...item, ...position };
  return {
    ...item,
    ...position,
    route: item.route.map((point) => migrateLegacyMapCoordinates(point.lat, point.lng)),
  };
}

export function loadItems(): MapItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(COORDINATE_VERSION_KEY, String(MAP_COORDINATE_VERSION));
      return seedItems;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      localStorage.setItem(COORDINATE_VERSION_KEY, String(MAP_COORDINATE_VERSION));
      return seedItems;
    }

    const items = parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => (item.kind === 'person' ? normalizePoint(item) : normalizeVehicle(item)));
    const coordinateVersion = Number(localStorage.getItem(COORDINATE_VERSION_KEY));
    if (coordinateVersion === MAP_COORDINATE_VERSION) return items;

    const migrated = items.map(migrateLegacyItemCoordinates);
    // Записываем преобразованные данные до версии: даже при аварийной перезагрузке
    // старые координаты не будут ошибочно помечены как уже обновлённые.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    localStorage.setItem(COORDINATE_VERSION_KEY, String(MAP_COORDINATE_VERSION));
    return migrated;
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
      pointName: '',
      personnel: [],
    };
  }

  return {
    ...base,
    kind,
    name: '',
    driver: '',
    status: 'parked',
    heading: 0,
    route: [],
    routeSegment: 0,
    routeProgress: 0,
    routeSpeed: 60,
  };
}

function personnelWord(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder10 === 1 && remainder100 !== 11) return 'сотрудник';
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) {
    return 'сотрудника';
  }
  return 'сотрудников';
}

export function itemTitle(item: MapItem): string {
  return item.kind === 'person'
    ? item.pointName || 'Новая точка'
    : item.name || 'Новая машина';
}

export function itemSubtitle(item: MapItem): string {
  if (item.kind === 'person') {
    if (item.personnel.length === 0) return 'Сотрудники не добавлены';
    if (item.personnel.length === 1) {
      const person = item.personnel[0];
      return person.position ? `${person.fullName} · ${person.position}` : person.fullName;
    }
    return `${item.personnel.length} ${personnelWord(item.personnel.length)}`;
  }
  return item.driver || 'Водитель не указан';
}
