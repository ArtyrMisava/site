import { useEffect, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { MAP_HEIGHT } from '../data';
import {
  loadMapGeography,
  type AreaLabel,
  type MapGeographyPayload,
  type PlaceLabel,
} from '../mapGeography';

type DrawLabel = {
  key: string;
  name: string;
  x: number;
  y: number;
  kind: 'place' | 'country' | 'region';
  priority: number;
  capital?: boolean;
  population?: number;
};

type Box = { left: number; top: number; right: number; bottom: number };

const VIEW_PADDING = 140;
const GRID_SIZE = 64;
const MAX_VISIBLE_LABELS = 280;

function placeIsVisible(place: PlaceLabel, zoom: number) {
  if (zoom < 0.65) return place.capital || place.population >= 1_000_000;
  if (zoom < 1.35) return place.capital || place.worldCity || place.population >= 400_000 || place.rank <= 4;
  if (zoom < 2.1) return place.capital || place.population >= 90_000 || place.rank <= 6;
  if (zoom < 2.85) return place.capital || place.population >= 18_000 || place.rank <= 8;
  return true;
}

function areaIsVisible(area: AreaLabel, zoom: number) {
  if (area.kind === 'country') return zoom < 2.35;
  if (zoom < 1.15) return false;
  if (zoom < 1.8) return area.rank <= 3;
  if (zoom < 2.6) return area.rank <= 5;
  return true;
}

function buildLabels(payload: MapGeographyPayload, zoom: number): DrawLabel[] {
  const areas = [...payload.countries, ...payload.regions]
    .filter((area) => areaIsVisible(area, zoom))
    .map<DrawLabel>((area) => ({
      key: `${area.kind}:${area.country}:${area.name}:${area.x}:${area.y}`,
      name: area.name,
      x: area.x,
      y: area.y,
      kind: area.kind,
      priority: area.kind === 'country' ? 10 + area.rank : 35 + area.rank,
    }));

  const places = payload.places
    .filter((place) => placeIsVisible(place, zoom))
    .map<DrawLabel>((place) => ({
      key: `place:${place.country}:${place.name}:${place.x}:${place.y}`,
      name: place.name,
      x: place.x,
      y: place.y,
      kind: 'place',
      priority: place.capital
        ? place.population >= 1_000_000 ? 0 : 3
        : Math.max(6, 30 - Math.log10(Math.max(10, place.population)) * 3 + place.rank),
      capital: place.capital,
      population: place.population,
    }));

  return [...places, ...areas].sort((left, right) =>
    left.priority - right.priority || (right.population ?? 0) - (left.population ?? 0) || left.name.localeCompare(right.name, 'ru'),
  );
}

function boxCells(box: Box) {
  const cells: string[] = [];
  const firstX = Math.floor(box.left / GRID_SIZE);
  const lastX = Math.floor(box.right / GRID_SIZE);
  const firstY = Math.floor(box.top / GRID_SIZE);
  const lastY = Math.floor(box.bottom / GRID_SIZE);
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) cells.push(`${x}:${y}`);
  }
  return cells;
}

function boxesOverlap(left: Box, right: Box) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

export function MapLabelsLayer() {
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

    const labelsByZoom = new Map<string, DrawLabel[]>();
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

      const zoom = map.getZoom();
      const zoomKey = zoom.toFixed(2);
      let labels = labelsByZoom.get(zoomKey);
      if (!labels) {
        labels = buildLabels(payload, zoom);
        labelsByZoom.set(zoomKey, labels);
      }
      const visibleBounds = map.getBounds().pad(0.35);
      const occupied = new Map<string, Box[]>();
      const accepted: Array<{ label: DrawLabel; point: L.Point; box: Box; font: string }> = [];

      for (const label of labels) {
        if (accepted.length >= MAX_VISIBLE_LABELS) break;
        const position = L.latLng(MAP_HEIGHT - label.y, label.x);
        if (!visibleBounds.contains(position)) continue;
        const layerPoint = map.latLngToLayerPoint(position);
        const point = layerPoint.subtract(topLeft);
        if (point.x < -80 || point.y < -30 || point.x > width + 80 || point.y > height + 30) continue;

        const font = label.kind === 'country'
          ? `${zoom >= 1.5 ? 700 : 600} ${zoom >= 1.5 ? 14 : 12}px "Segoe UI", Arial, sans-serif`
          : label.kind === 'region'
            ? '600 11px "Segoe UI", Arial, sans-serif'
            : `${label.capital ? 700 : 600} ${label.capital ? 12 : 11}px "Segoe UI", Arial, sans-serif`;
        context.font = font;
        const value = label.kind === 'country' ? label.name.toLocaleUpperCase('ru') : label.name;
        const textWidth = context.measureText(value).width;
        const dotOffset = label.kind === 'place' ? 7 : 0;
        const box: Box = {
          left: point.x - (label.kind === 'place' ? 4 : textWidth / 2 + 4),
          top: point.y - 9,
          right: point.x + (label.kind === 'place' ? dotOffset + textWidth + 4 : textWidth / 2 + 4),
          bottom: point.y + 9,
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

      for (const { label, point, font } of accepted) {
        context.font = font;
        if (label.kind === 'place') {
          context.beginPath();
          context.arc(point.x, point.y, label.capital ? 3.2 : 2.4, 0, Math.PI * 2);
          context.fillStyle = label.capital ? '#bd5046' : '#486c78';
          context.fill();
          context.lineWidth = 1.4;
          context.strokeStyle = 'rgba(255,255,255,.96)';
          context.stroke();
          context.textAlign = 'left';
          context.lineWidth = 3.2;
          context.strokeStyle = 'rgba(255,255,255,.96)';
          context.strokeText(label.name, point.x + 7, point.y);
          context.fillStyle = label.capital ? '#3f4547' : '#40545b';
          context.fillText(label.name, point.x + 7, point.y);
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
      canvas.dataset.zoom = zoom.toFixed(2);
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
  }, [map, payload]);

  return null;
}
