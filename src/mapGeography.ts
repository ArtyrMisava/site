import { MAP_HEIGHT } from './data';

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
}

let geographyRequest: Promise<MapGeographyPayload> | null = null;

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

export function findNearestSettlement(
  payload: MapGeographyPayload,
  lat: number,
  lng: number,
): PlaceLabel | null {
  const mapY = MAP_HEIGHT - lat;
  let nearest: PlaceLabel | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const place of payload.places) {
    const horizontal = place.x - lng;
    const vertical = place.y - mapY;
    const distance = horizontal * horizontal + vertical * vertical;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = place;
    }
  }
  return nearest;
}
