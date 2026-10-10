import { useEffect, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { MAP_HEIGHT } from '../data';
import { labelZoomForMode, type MapLayerMode } from '../mapLayers';
import {
  findSettlementsInBounds,
  loadMapGeography,
  type AreaLabel,
  type MapGeographyPayload,
  type PlaceLabel,
} from '../mapGeography';

type DrawLabel = {
  name: string;
  x: number;
  y: number;
  kind: 'place' | 'country' | 'region';
  capital?: boolean;
  population?: number;
  rank?: number;
};

type Box = { left: number; top: number; right: number; bottom: number };

const VIEW_PADDING = 140;
const GRID_SIZE = 60;
const MAX_VISIBLE_LABELS = 300;
const MAX_PLACE_CANDIDATES = 4000;

function placeIsVisible(place: PlaceLabel, zoom: number) {
  return zoom + 0.001 >= place.minZoom;
}

function areaIsVisible(area: AreaLabel, zoom: number) {
  // Названия стран нужны на общем обзоре, но на региональном масштабе
  // уступают место плотной сетке городов, посёлков и районных центров.
  if (area.kind === 'country') return zoom < 1.4;
  if (zoom < 1.2) return false;
  if (zoom < 1.8) return area.rank <= 3;
  if (zoom < 2.6) return area.rank <= 5;
  return true;
}

function buildLabels(
  payload: MapGeographyPayload,
  visiblePlaces: PlaceLabel[],
  zoom: number,
): DrawLabel[] {
  const areas = [...payload.countries, ...payload.regions]
    .filter((area) => areaIsVisible(area, zoom))
    .map<DrawLabel>((area) => ({
      name: area.name,
      x: area.x,
      y: area.y,
      kind: area.kind,
    }));

  const places: DrawLabel[] = [];
  for (const place of visiblePlaces) {
    if (!placeIsVisible(place, zoom)) continue;
    places.push({
      name: place.name,
      x: place.x,
      y: place.y,
      kind: 'place',
      capital: place.capital,
      population: place.population,
      rank: place.rank,
    });
    if (places.length >= MAX_PLACE_CANDIDATES) break;
  }

  return [...places, ...areas];
}

function boxCells(box: Box) {
  const cells: number[] = [];
  const firstX = Math.floor(box.left / GRID_SIZE);
  const lastX = Math.floor(box.right / GRID_SIZE);
  const firstY = Math.floor(box.top / GRID_SIZE);
  const lastY = Math.floor(box.bottom / GRID_SIZE);
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) cells.push(x * 10_000 + y);
  }
  return cells;
}

function boxesOverlap(left: Box, right: Box) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

export function MapLabelsLayer({ mode }: { mode: MapLayerMode }) {
  const map = useMap();
  const [payload, setPayload] = useState<MapGeographyPayload | null>(null);

  useEffect(() => {
    let active = true;
    loadMapGeography()
      .then((data) => {
        if (active) setPayload(data);
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!payload) return undefined;

    const paneName = 'geographicLabelsPane';
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'none';

    const canvas = L.DomUtil.create('canvas', 'map-geographic-labels', pane) as HTMLCanvasElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.pointerEvents = 'none';
    const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) {
      canvas.remove();
      return undefined;
    }

    let frame = 0;
    const render = () => {
      const startedAt = performance.now();
      frame = 0;
      const size = map.getSize();
      const width = size.x + VIEW_PADDING * 2;
      const height = size.y + VIEW_PADDING * 2;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const topLeft = map.containerPointToLayerPoint([-VIEW_PADDING, -VIEW_PADDING]);
      L.DomUtil.setPosition(canvas, topLeft);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineJoin = 'round';
      context.textBaseline = 'middle';

      const mapZoom = map.getZoom();
      const labelZoom = labelZoomForMode(mode, mapZoom);
      const visibleBounds = map.getBounds().pad(0.18);
      const visiblePlaces = findSettlementsInBounds(
        payload,
        visibleBounds.getWest(),
        MAP_HEIGHT - visibleBounds.getNorth(),
        visibleBounds.getEast(),
        MAP_HEIGHT - visibleBounds.getSouth(),
      );
      const queriedAt = performance.now();
      const labels = buildLabels(payload, visiblePlaces, labelZoom);
      const labelsBuiltAt = performance.now();
      const occupied = new Map<number, Box[]>();
      const accepted: Array<{
        label: DrawLabel;
        point: { x: number; y: number };
        box: Box;
        font: string;
      }> = [];
      const pixelOrigin = map.getPixelOrigin();
      const projectedOrigin = map.project([0, 0], mapZoom);
      const xScale = map.project([0, 1], mapZoom).x - projectedOrigin.x;
      const yScale = map.project([1, 0], mapZoom).y - projectedOrigin.y;

      for (const label of labels) {
        if (accepted.length >= MAX_VISIBLE_LABELS) break;
        const layerX = Math.round(projectedOrigin.x + label.x * xScale) - pixelOrigin.x;
        const layerY = Math.round(projectedOrigin.y + (MAP_HEIGHT - label.y) * yScale) - pixelOrigin.y;
        const point = { x: layerX - topLeft.x, y: layerY - topLeft.y };
        if (point.x < -80 || point.y < -30 || point.x > width + 80 || point.y > height + 30) continue;

        const majorPlace = label.kind === 'place'
          && (label.capital || (label.population ?? 0) >= 100_000 || (label.rank ?? 10) <= 3);
        const mediumPlace = label.kind === 'place'
          && ((label.population ?? 0) >= 10_000 || (label.rank ?? 10) <= 6);
        const font = label.kind === 'country'
          ? '650 12px "Segoe UI", Arial, sans-serif'
          : label.kind === 'region'
            ? '600 10.5px "Segoe UI", Arial, sans-serif'
            : majorPlace
              ? `${label.capital ? 700 : 650} ${label.capital ? 12 : 11.5}px "Segoe UI", Arial, sans-serif`
              : mediumPlace
                ? '600 10.5px "Segoe UI", Arial, sans-serif'
                : '500 10px "Segoe UI", Arial, sans-serif';
        const value = label.kind === 'country' ? label.name.toLocaleUpperCase('ru') : label.name;
        const averageCharacterWidth = label.kind === 'country'
          ? 6.8
          : label.kind === 'region'
            ? 5.8
            : majorPlace
              ? 6.1
              : mediumPlace ? 5.6 : 5.2;
        const textWidth = value.length * averageCharacterWidth;
        const dotOffset = label.kind === 'place' ? 6.5 : 0;
        const halfHeight = majorPlace || label.kind !== 'place' ? 9 : 8;
        const box: Box = {
          left: point.x - (label.kind === 'place' ? 3.5 : textWidth / 2 + 4),
          top: point.y - halfHeight,
          right: point.x + (label.kind === 'place' ? dotOffset + textWidth + 3.5 : textWidth / 2 + 4),
          bottom: point.y + halfHeight,
        };
        const cells = boxCells(box);
        const collision = cells.some((cell) => occupied.get(cell)?.some((other) => boxesOverlap(box, other)));
        if (collision) continue;
        for (const cell of cells) {
          const entries = occupied.get(cell);
          if (entries) entries.push(box);
          else occupied.set(cell, [box]);
        }
        accepted.push({ label: { ...label, name: value }, point, box, font });
      }
      const layoutFinishedAt = performance.now();

      for (const { label, point, font } of accepted) {
        context.font = font;
        if (label.kind === 'place') {
          const majorPlace = label.capital
            || (label.population ?? 0) >= 100_000
            || (label.rank ?? 10) <= 3;
          context.beginPath();
          context.arc(point.x, point.y, label.capital ? 3 : majorPlace ? 2.25 : 1.65, 0, Math.PI * 2);
          context.fillStyle = label.capital ? '#b94d45' : majorPlace ? '#496b76' : '#70858a';
          context.fill();
          context.lineWidth = majorPlace ? 1.25 : 1;
          context.strokeStyle = 'rgba(255,255,255,.96)';
          context.stroke();
          context.textAlign = 'left';
          context.lineWidth = majorPlace ? 3.2 : 2.8;
          context.strokeStyle = 'rgba(255,255,255,.96)';
          context.strokeText(label.name, point.x + 6.5, point.y);
          context.fillStyle = label.capital ? '#353d40' : majorPlace ? '#374b51' : '#4d5e62';
          context.fillText(label.name, point.x + 6.5, point.y);
        } else {
          context.textAlign = 'center';
          context.lineWidth = label.kind === 'country' ? 4 : 3;
          context.strokeStyle = label.kind === 'country' ? 'rgba(248,247,241,.9)' : 'rgba(255,255,255,.88)';
          context.strokeText(label.name, point.x, point.y);
          context.fillStyle = label.kind === 'country' ? 'rgba(76,92,95,.72)' : 'rgba(91,102,100,.72)';
          context.fillText(label.name, point.x, point.y);
        }
      }
      canvas.dataset.visibleLabels = String(accepted.length);
      canvas.dataset.visibleSettlements = String(accepted.filter(({ label }) => label.kind === 'place').length);
      canvas.dataset.candidateSettlements = String(visiblePlaces.length);
      canvas.dataset.totalSettlements = String(payload.places.length);
      canvas.dataset.zoom = mapZoom.toFixed(2);
      canvas.dataset.labelZoom = labelZoom.toFixed(2);
      canvas.dataset.layerMode = mode;
      canvas.dataset.queryMs = (queriedAt - startedAt).toFixed(1);
      canvas.dataset.buildMs = (labelsBuiltAt - queriedAt).toFixed(1);
      canvas.dataset.layoutMs = (layoutFinishedAt - labelsBuiltAt).toFixed(1);
      canvas.dataset.renderMs = (performance.now() - startedAt).toFixed(1);
    };

    const scheduleRender = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    map.on('zoom zoomend moveend resize viewreset', scheduleRender);
    render();

    return () => {
      map.off('zoom zoomend moveend resize viewreset', scheduleRender);
      if (frame) window.cancelAnimationFrame(frame);
      canvas.remove();
    };
  }, [map, mode, payload]);

  return null;
}
