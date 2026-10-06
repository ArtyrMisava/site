#!/usr/bin/env node
/**
 * Rasterize generated Natural Earth SVGs into a Leaflet tile pyramid.
 *
 * Optional build dependencies (not used by the website at runtime):
 *   npm install --no-save @resvg/resvg-js sharp
 *
 * Usage:
 *   node scripts/generate-map-tiles.mjs <svg-directory> <tile-directory>
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1000;
const TILE_SIZE = 512;
const MAX_NATIVE_ZOOM = 3;
const CONCURRENCY = Math.max(1, Math.min(4, cpus().length));

const [, , sourceArgument, outputArgument] = process.argv;
if (!sourceArgument || !outputArgument) {
  throw new Error('Usage: generate-map-tiles.mjs <svg-directory> <tile-directory>');
}

const sourceDirectory = resolve(sourceArgument);
const outputDirectory = resolve(outputArgument);
const sourceByZoom = [
  'real-region.svg',
  'real-region-detail.svg',
  'real-region-detail.svg',
  'real-region-ultra.svg',
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

let tileCount = 0;

function rawTile(source, sourceWidth, channels, left, top) {
  const target = Buffer.allocUnsafe(TILE_SIZE * TILE_SIZE * channels);
  const sourceRowLength = sourceWidth * channels;
  const tileRowLength = TILE_SIZE * channels;
  for (let row = 0; row < TILE_SIZE; row += 1) {
    const sourceStart = (top + row) * sourceRowLength + left * channels;
    source.copy(target, row * tileRowLength, sourceStart, sourceStart + tileRowLength);
  }
  return target;
}

for (let zoom = 0; zoom <= MAX_NATIVE_ZOOM; zoom += 1) {
  const scale = 2 ** zoom;
  const renderedWidth = MAP_WIDTH * scale;
  const renderedHeight = MAP_HEIGHT * scale;
  const columnCount = Math.ceil(renderedWidth / TILE_SIZE);
  const rowCount = Math.ceil(renderedHeight / TILE_SIZE);
  const minimumTileY = -rowCount;
  const topPadding = rowCount * TILE_SIZE - renderedHeight;
  const rightPadding = columnCount * TILE_SIZE - renderedWidth;
  const source = await readFile(join(sourceDirectory, sourceByZoom[zoom]), 'utf8');

  process.stdout.write(`Rendering zoom ${zoom} (${renderedWidth}x${renderedHeight})\n`);
  const png = new Resvg(source, {
    fitTo: { mode: 'width', value: renderedWidth },
    shapeRendering: 2,
    textRendering: 1,
  }).render().asPng();

  const { data, info } = await sharp(png, { limitInputPixels: false })
    .ensureAlpha()
    .extend({
      top: topPadding,
      bottom: 0,
      left: 0,
      right: rightPadding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const jobs = [];
  for (let x = 0; x < columnCount; x += 1) {
    for (let row = 0; row < rowCount; row += 1) {
      jobs.push({ x, row, y: minimumTileY + row });
    }
  }

  let nextJob = 0;
  let completed = 0;
  async function worker() {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob];
      nextJob += 1;
      const tile = rawTile(data, info.width, info.channels, job.x * TILE_SIZE, job.row * TILE_SIZE);
      const tileDirectory = join(outputDirectory, String(zoom), String(job.x));
      await mkdir(tileDirectory, { recursive: true });
      await sharp(tile, {
        raw: { width: TILE_SIZE, height: TILE_SIZE, channels: info.channels },
      })
        .webp({ quality: 88, alphaQuality: 100, smartSubsample: true, effort: 4 })
        .toFile(join(tileDirectory, `${job.y}.webp`));
      completed += 1;
      tileCount += 1;
      if (completed % 50 === 0 || completed === jobs.length) {
        process.stdout.write(`Zoom ${zoom}: ${completed}/${jobs.length} tiles\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

await writeFile(
  join(outputDirectory, 'manifest.json'),
  `${JSON.stringify({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tileSize: TILE_SIZE,
    minNativeZoom: 0,
    maxNativeZoom: MAX_NATIVE_ZOOM,
    tileCount,
    sources: sourceByZoom,
  }, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`Wrote ${tileCount} tiles to ${outputDirectory}\n`);
