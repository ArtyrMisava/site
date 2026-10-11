import { useEffect, useMemo, useState } from 'react';
import {
  geographicCoordinatesToMap,
  MAP_HEIGHT,
  MAP_WIDTH,
} from './data';
import { setPersistentItem } from './siteStorage';
import type { RoutePoint } from './types';

export const FRONTLINE_STORAGE_KEY = 'dus-frontline-layer-v1';
const FRONTLINE_EVENT = 'dus-frontline-layer-change';

interface BundledFrontlinePayload {
  format: number;
  title: string;
  dataDate: string;
  generatedAt?: string;
  sourceName: string;
  sourceUrl: string;
  license?: string;
  notice: string;
  segments: unknown;
}

export interface FrontlineSnapshot {
  title: string;
  dataDate: string;
  generatedAt: string;
  sourceName: string;
  sourceUrl: string;
  notice: string;
  segments: RoutePoint[][];
  editedAt: string;
  custom: boolean;
}

interface StoredFrontlineState {
  visible: boolean;
  custom: FrontlineSnapshot | null;
}

const emptyStoredState = (): StoredFrontlineState => ({ visible: false, custom: null });

function normalizeMapPoint(value: unknown): RoutePoint | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Partial<RoutePoint>;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return {
    lat: Math.min(MAP_HEIGHT, Math.max(0, Number(point.lat))),
    lng: Math.min(MAP_WIDTH, Math.max(0, Number(point.lng))),
  };
}

export function normalizeFrontlineSegments(value: unknown): RoutePoint[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((segment) => (
      Array.isArray(segment)
        ? segment.map(normalizeMapPoint).filter((point): point is RoutePoint => point !== null)
        : []
    ))
    .filter((segment) => segment.length >= 2);
}

function normalizeCustomSnapshot(value: unknown): FrontlineSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FrontlineSnapshot>;
  const segments = normalizeFrontlineSegments(candidate.segments);
  if (segments.length === 0) return null;
  return {
    title: String(candidate.title || 'Линия боевого соприкосновения'),
    dataDate: String(candidate.dataDate || ''),
    generatedAt: String(candidate.generatedAt || ''),
    sourceName: String(candidate.sourceName || 'Изменено администратором'),
    sourceUrl: String(candidate.sourceUrl || ''),
    notice: String(candidate.notice || 'Линия отредактирована администратором.'),
    segments,
    editedAt: String(candidate.editedAt || ''),
    custom: true,
  };
}

function readStoredState(): StoredFrontlineState {
  try {
    const raw = localStorage.getItem(FRONTLINE_STORAGE_KEY);
    if (!raw) return emptyStoredState();
    const parsed = JSON.parse(raw) as Partial<StoredFrontlineState>;
    return {
      visible: parsed.visible === true,
      custom: normalizeCustomSnapshot(parsed.custom),
    };
  } catch {
    return emptyStoredState();
  }
}

function geographicSegment(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
      const longitude = Number(coordinate[0]);
      const latitude = Number(coordinate[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return geographicCoordinatesToMap(latitude, longitude);
    })
    .filter((point): point is RoutePoint => point !== null);
}

function normalizeBundledPayload(payload: BundledFrontlinePayload): FrontlineSnapshot {
  const segments = Array.isArray(payload.segments)
    ? payload.segments
      .map(geographicSegment)
      .filter((segment) => segment.length >= 2)
    : [];
  if (payload.format !== 1 || segments.length === 0) {
    throw new Error('Файл линии боевого соприкосновения повреждён');
  }
  return {
    title: String(payload.title || 'Линия боевого соприкосновения'),
    dataDate: String(payload.dataDate || ''),
    generatedAt: String(payload.generatedAt || ''),
    sourceName: String(payload.sourceName || 'Открытый источник'),
    sourceUrl: String(payload.sourceUrl || ''),
    notice: String(payload.notice || 'Оценочные данные из открытого источника.'),
    segments,
    editedAt: '',
    custom: false,
  };
}

function persistStoredState(state: StoredFrontlineState): void {
  setPersistentItem(FRONTLINE_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(FRONTLINE_EVENT, { detail: state }));
}

export interface FrontlineLayerController {
  snapshot: FrontlineSnapshot | null;
  visible: boolean;
  loading: boolean;
  error: string;
  setVisible: (visible: boolean) => void;
  saveCustom: (segments: RoutePoint[][]) => void;
  resetCustom: () => void;
}

export function useFrontlineLayer(): FrontlineLayerController {
  const [stored, setStored] = useState<StoredFrontlineState>(readStoredState);
  const [bundled, setBundled] = useState<FrontlineSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/maps/frontline.json', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Ошибка загрузки (${response.status})`);
        return response.json() as Promise<BundledFrontlinePayload>;
      })
      .then((payload) => {
        if (active) setBundled(normalizeBundledPayload(payload));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить линию');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const update = () => setStored(readStoredState());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === FRONTLINE_STORAGE_KEY) update();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(FRONTLINE_EVENT, update);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(FRONTLINE_EVENT, update);
    };
  }, []);

  const snapshot = stored.custom ?? bundled;

  return useMemo(() => ({
    snapshot,
    visible: stored.visible,
    loading: !snapshot && !error,
    error,
    setVisible(visible: boolean) {
      const next = { ...stored, visible };
      setStored(next);
      persistStoredState(next);
    },
    saveCustom(segments: RoutePoint[][]) {
      const normalized = normalizeFrontlineSegments(segments);
      if (!snapshot || normalized.length === 0) return;
      const custom: FrontlineSnapshot = {
        ...snapshot,
        segments: normalized,
        editedAt: new Date().toISOString(),
        custom: true,
      };
      const next = { visible: true, custom };
      setStored(next);
      persistStoredState(next);
    },
    resetCustom() {
      const next = { visible: stored.visible, custom: null };
      setStored(next);
      persistStoredState(next);
    },
  }), [bundled, error, snapshot, stored]);
}

export function cloneFrontlineSegments(segments: RoutePoint[][]): RoutePoint[][] {
  return segments.map((segment) => segment.map((point) => ({ ...point })));
}

export function formatFrontlineDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || 'дата не указана';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
