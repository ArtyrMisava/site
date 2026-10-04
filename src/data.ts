import type {
  MapItem,
  PersonnelEntry,
  PersonPoint,
  VehiclePoint,
} from './types';

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1000;
export const STORAGE_KEY = 'lokus-map-items-v1';

const now = '2026-10-04T09:00:00.000Z';

export const seedItems: MapItem[] = [
  {
    id: 'point-office',
    kind: 'person',
    pointName: 'Центральный офис',
    personnel: [
      { id: 'person-ivan-petrov', fullName: 'Иван Петров', position: 'Руководитель смены' },
    ],
    lat: 530,
    lng: 780,
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
    lat: 700,
    lng: 1270,
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
    lat: Number.isFinite(Number(value.lat)) ? Number(value.lat) : MAP_HEIGHT / 2,
    lng: Number.isFinite(Number(value.lng)) ? Number(value.lng) : MAP_WIDTH / 2,
    createdAt: String(value.createdAt ?? timestamp),
    updatedAt: String(value.updatedAt ?? timestamp),
  };
}

export function loadItems(): MapItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedItems;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return seedItems;

    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => (item.kind === 'person' ? normalizePoint(item) : item as unknown as VehiclePoint));
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
