export interface BuiltInPlaceIcon {
  id: string;
  label: string;
  source: string;
}

export const DEFAULT_PLACE_ICON = 'pin';
export const MAX_CUSTOM_PLACE_ICON_LENGTH = 24_000;

export const BUILT_IN_PLACE_ICONS: BuiltInPlaceIcon[] = [
  { id: 'pin', label: 'Метка', source: '/icons/places/pin.svg' },
  { id: 'office', label: 'Офис', source: '/icons/places/office.svg' },
  { id: 'house', label: 'Дом', source: '/icons/places/house.svg' },
  { id: 'houses', label: 'Домики', source: '/icons/places/houses.svg' },
  { id: 'warehouse', label: 'Склад', source: '/icons/places/warehouse.svg' },
  { id: 'checkpoint', label: 'КПП', source: '/icons/places/checkpoint.svg' },
  { id: 'satellite', label: 'Спутник', source: '/icons/places/satellite.svg' },
  { id: 'headquarters', label: 'Штаб', source: '/icons/places/headquarters.svg' },
];

const builtInById = new Map(BUILT_IN_PLACE_ICONS.map((icon) => [icon.id, icon]));
const customIconPattern = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i;

export function isCustomPlaceIcon(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_CUSTOM_PLACE_ICON_LENGTH
    && customIconPattern.test(value);
}

export function normalizePlaceIcon(value: unknown): string {
  if (typeof value === 'string' && builtInById.has(value)) return value;
  if (isCustomPlaceIcon(value)) return value;
  return DEFAULT_PLACE_ICON;
}

export function placeIconSource(value: unknown): string {
  const normalized = normalizePlaceIcon(value);
  if (isCustomPlaceIcon(normalized)) return normalized;
  return builtInById.get(normalized)?.source ?? builtInById.get(DEFAULT_PLACE_ICON)!.source;
}
