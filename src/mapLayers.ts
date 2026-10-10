import { useEffect, useState } from 'react';
import { setPersistentItem } from './siteStorage';

export type MapLayerMode = 'auto' | 'overview' | 'detail' | 'maximum';

export const MAP_LAYER_MODE_STORAGE_KEY = 'dus-map-layer-mode-v1';
export const MAP_LAYER_MODE_EVENT = 'dus-map-layer-mode-change';

export const MAP_LAYER_OPTIONS: Array<{
  id: MapLayerMode;
  label: string;
  description: string;
}> = [
  { id: 'auto', label: 'Авто', description: 'Детализация меняется при приближении' },
  { id: 'overview', label: 'Обзор', description: 'Основная карта и крупные города' },
  { id: 'detail', label: 'Подробно', description: 'Дороги, реки, города и посёлки' },
  { id: 'maximum', label: 'Максимум', description: 'Вся доступная детализация и сёла' },
];

export function normalizeMapLayerMode(value: unknown): MapLayerMode {
  return value === 'overview' || value === 'detail' || value === 'maximum' ? value : 'auto';
}

export function useMapLayerMode(): [MapLayerMode, (mode: MapLayerMode) => void] {
  const [mode, setModeState] = useState<MapLayerMode>(() =>
    normalizeMapLayerMode(localStorage.getItem(MAP_LAYER_MODE_STORAGE_KEY)),
  );

  useEffect(() => {
    const update = (value: string | null) => setModeState(normalizeMapLayerMode(value));
    const handleStorage = (event: StorageEvent) => {
      if (event.key === MAP_LAYER_MODE_STORAGE_KEY) update(event.newValue);
    };
    const handleLocalChange = (event: Event) => {
      update((event as CustomEvent<string>).detail);
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(MAP_LAYER_MODE_EVENT, handleLocalChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(MAP_LAYER_MODE_EVENT, handleLocalChange);
    };
  }, []);

  const setMode = (nextMode: MapLayerMode) => {
    setModeState(nextMode);
    setPersistentItem(MAP_LAYER_MODE_STORAGE_KEY, nextMode);
    window.dispatchEvent(new CustomEvent(MAP_LAYER_MODE_EVENT, { detail: nextMode }));
  };

  return [mode, setMode];
}

export function labelZoomForMode(mode: MapLayerMode, mapZoom: number): number {
  if (mode === 'overview') return 0.65;
  if (mode === 'detail') return 1.72;
  if (mode === 'maximum') return 3.5;
  return mapZoom;
}
