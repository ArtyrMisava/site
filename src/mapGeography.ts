import { MAP_HEIGHT, MAP_WIDTH } from './data';

export interface PlaceLabel {
  name: string;
  x: number;
  y: number;
  population: number;
  capital: boolean;
  worldCity: boolean;
  rank: number;
  minZoom: number;
  country: string;
}

export interface AreaLabel {
  name: string;
  x: number;
  y: number;
  rank: number;
  minZoom: number;
  kind: 'country' | 'region';
  country: string;
}

export interface MapGeographyPayload {
  bounds: { west: number; south: number; east: number; north: number };
  places: PlaceLabel[];
  countries: AreaLabel[];
  regions: AreaLabel[];
  sources?: {
    baseMap: string;
    settlements: string;
    settlementCount: number;
  };
}

interface PlaceGridIndex {
  cells: Array<PlaceLabel[] | undefined>;
}

const PLACE_GRID_SIZE = 40;
const PLACE_GRID_COLUMNS = Math.ceil(MAP_WIDTH / PLACE_GRID_SIZE);
const PLACE_GRID_ROWS = Math.ceil(MAP_HEIGHT / PLACE_GRID_SIZE);
const placeGridCache = new WeakMap<MapGeographyPayload, PlaceGridIndex>();
let geographyRequest: Promise<MapGeographyPayload> | null = null;

function cellColumn(x: number): number {
  return Math.min(PLACE_GRID_COLUMNS - 1, Math.max(0, Math.floor(x / PLACE_GRID_SIZE)));
}

function cellRow(y: number): number {
  return Math.min(PLACE_GRID_ROWS - 1, Math.max(0, Math.floor(y / PLACE_GRID_SIZE)));
}

function cellIndex(column: number, row: number): number {
  return row * PLACE_GRID_COLUMNS + column;
}

function placeGrid(payload: MapGeographyPayload): PlaceGridIndex {
  const cached = placeGridCache.get(payload);
  if (cached) return cached;

  const index: PlaceGridIndex = { cells: new Array(PLACE_GRID_COLUMNS * PLACE_GRID_ROWS) };
  for (const place of payload.places) {
    const indexPosition = cellIndex(cellColumn(place.x), cellRow(place.y));
    const entries = index.cells[indexPosition];
    if (entries) entries.push(place);
    else index.cells[indexPosition] = [place];
  }
  placeGridCache.set(payload, index);
  return index;
}

export function loadMapGeography(): Promise<MapGeographyPayload> {
  if (!geographyRequest) {
    geographyRequest = fetch('/maps/places.json').then((response) => {
      if (!response.ok) throw new Error(`Не удалось загрузить подписи карты (${response.status})`);
      return response.json() as Promise<MapGeographyPayload>;
    });
  }
  return geographyRequest;
}

export function preloadMapGeography(): void {
  void loadMapGeography().catch((error: unknown) => console.error(error));
}

export function findSettlementsInBounds(
  payload: MapGeographyPayload,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): PlaceLabel[] {
  if (maxX < 0 || maxY < 0 || minX > MAP_WIDTH || minY > MAP_HEIGHT) return [];
  // places.json уже отсортирован по картографическому приоритету. Линейный
  // проход по компактной локальной базе сохраняет этот порядок и оказывается
  // быстрее, чем сбор ячеек с последующей сортировкой на каждом перемещении.
  const matches: PlaceLabel[] = [];
  for (const place of payload.places) {
    if (place.x >= minX && place.x <= maxX && place.y >= minY && place.y <= maxY) {
      matches.push(place);
    }
  }
  return matches;
}

export function findNearestSettlement(
  payload: MapGeographyPayload,
  lat: number,
  lng: number,
): PlaceLabel | null {
  const x = Math.min(MAP_WIDTH, Math.max(0, lng));
  const y = Math.min(MAP_HEIGHT, Math.max(0, MAP_HEIGHT - lat));
  const originColumn = cellColumn(x);
  const originRow = cellRow(y);
  const index = placeGrid(payload);
  const visited = new Set<number>();
  let nearest: PlaceLabel | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const maximumRadius = Math.max(PLACE_GRID_COLUMNS, PLACE_GRID_ROWS);

  for (let radius = 0; radius <= maximumRadius; radius += 1) {
    const firstColumn = Math.max(0, originColumn - radius);
    const lastColumn = Math.min(PLACE_GRID_COLUMNS - 1, originColumn + radius);
    const firstRow = Math.max(0, originRow - radius);
    const lastRow = Math.min(PLACE_GRID_ROWS - 1, originRow + radius);

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const indexPosition = cellIndex(column, row);
        if (visited.has(indexPosition)) continue;
        visited.add(indexPosition);
        const entries = index.cells[indexPosition];
        if (!entries) continue;
        for (const place of entries) {
          const horizontal = place.x - x;
          const vertical = place.y - y;
          const distance = horizontal * horizontal + vertical * vertical;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = place;
          }
        }
      }
    }

    if (!nearest) continue;
    const distanceToUnsearchedArea = Math.min(
      firstColumn > 0 ? x - firstColumn * PLACE_GRID_SIZE : Number.POSITIVE_INFINITY,
      lastColumn < PLACE_GRID_COLUMNS - 1 ? (lastColumn + 1) * PLACE_GRID_SIZE - x : Number.POSITIVE_INFINITY,
      firstRow > 0 ? y - firstRow * PLACE_GRID_SIZE : Number.POSITIVE_INFINITY,
      lastRow < PLACE_GRID_ROWS - 1 ? (lastRow + 1) * PLACE_GRID_SIZE - y : Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(distanceToUnsearchedArea) || nearestDistance <= distanceToUnsearchedArea ** 2) {
      break;
    }
  }
  return nearest;
}
