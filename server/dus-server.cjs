'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

const SERVER_VERSION = '1.0.0';
const DEFAULT_PORT = 4173;
const MAX_STATE_SIZE = 32 * 1024 * 1024;
const ALLOWED_STORAGE_KEYS = new Set([
  'lokus-admin-credentials-v1',
  'lokus-map-items-v1',
  'dus-map-coordinate-version',
  'dus-map-view-link-v1',
  'dus-map-layer-mode-v1',
]);

function commandLine() {
  const values = new Map();
  const flags = new Set();
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (!argument.startsWith('-')) continue;
    const name = argument.replace(/^-+/, '');
    const next = process.argv[index + 1];
    if (next && !next.startsWith('-')) {
      values.set(name, next);
      index += 1;
    } else {
      flags.add(name);
    }
  }
  return { values, flags };
}

function applicationBase() {
  const executableDirectory = path.dirname(process.execPath);
  return path.basename(executableDirectory).toLocaleLowerCase() === 'runtime'
    ? path.dirname(executableDirectory)
    : path.resolve(__dirname, '..');
}

function emptyState() {
  return { format: 1, updatedAt: '', entries: {} };
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) return { state: emptyState(), initialized: false };
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state.entries || typeof state.entries !== 'object') state.entries = {};
    return { state, initialized: true };
  } catch (error) {
    try {
      const state = JSON.parse(fs.readFileSync(`${statePath}.bak`, 'utf8'));
      if (!state.entries || typeof state.entries !== 'object') state.entries = {};
      return { state, initialized: true };
    } catch {
      throw new Error(`Файл данных повреждён: ${error.message}`);
    }
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const prepared = {
    format: 1,
    updatedAt: new Date().toISOString(),
    entries: state.entries && typeof state.entries === 'object' ? state.entries : {},
  };
  if (fs.existsSync(statePath)) {
    fs.copyFileSync(statePath, `${statePath}.bak`);
  }
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(prepared, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temporary, statePath);
  } catch {
    try { fs.rmSync(statePath, { force: true }); } catch { /* handled by rename */ }
    fs.renameSync(temporary, statePath);
  }
}

function validOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host.toLocaleLowerCase() === String(request.headers.host).toLocaleLowerCase();
  } catch {
    return false;
  }
}

function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-DUS-Storage': 'folder',
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_STATE_SIZE) {
        reject(new Error('Слишком большой файл данных'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Некорректные данные'));
      }
    });
    request.on('error', reject);
  });
}

async function storageRequest(request, response, statePath) {
  if (!validOrigin(request)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  if (request.method === 'GET') {
    try {
      const { state, initialized } = readState(statePath);
      sendJson(response, 200, { initialized, entries: state.entries });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (request.method !== 'PUT' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, PUT, POST');
    response.writeHead(405).end('Method not allowed');
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const entries = {};
    let totalSize = 0;
    if (payload.entries && typeof payload.entries === 'object') {
      for (const [key, value] of Object.entries(payload.entries)) {
        if (!ALLOWED_STORAGE_KEYS.has(key) || typeof value !== 'string') continue;
        totalSize += Buffer.byteLength(key) + Buffer.byteLength(value);
        if (totalSize > MAX_STATE_SIZE) throw new Error('Слишком большой файл данных');
        entries[key] = value;
      }
    }
    writeState(statePath, { entries });
    sendJson(response, 200, { saved: true });
  } catch (error) {
    if (!response.headersSent) sendJson(response, 400, { error: error.message });
  }
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function staticRequest(request, response, root) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  const relativeURL = pathname.replace(/^\/+/, '') || 'index.html';
  let filePath = path.resolve(root, relativeURL);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (!path.extname(filePath)) filePath = path.join(root, 'index.html');
  }

  let stats;
  try {
    stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error('Not a file');
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(filePath).toLocaleLowerCase()] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function openBrowser(address) {
  if (process.platform !== 'win32') return;
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.statSync(candidate).isFile()) {
        spawn(candidate, [address], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
    } catch { /* try the next browser */ }
  }
  spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', address], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function resetAdministrator(statePath) {
  const { state } = readState(statePath);
  delete state.entries['lokus-admin-credentials-v1'];
  writeState(statePath, state);
  console.log('Administrator access was reset.');
  console.log('Map points, vehicles, routes and settings were preserved.');
  console.log('Start DUS and create a new administrator PIN.');
}

async function listenOnAvailablePort(server, firstPort) {
  for (let port = firstPort; port < firstPort + 10; port += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }
  }
  throw new Error(`Порты ${firstPort}-${firstPort + 9} заняты`);
}

async function main() {
  const { values, flags } = commandLine();
  if (flags.has('version')) {
    console.log(SERVER_VERSION);
    return;
  }

  const base = applicationBase();
  const root = path.resolve(values.get('root') || path.join(base, 'offline-site'));
  const statePath = path.resolve(values.get('data') || path.join(base, 'site-data', 'dus-data.json'));
  const firstPort = Number(values.get('port') || DEFAULT_PORT);

  if (flags.has('reset-admin')) {
    resetAdministrator(statePath);
    return;
  }
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error(`Файлы сайта не найдены: ${root}`);
  }

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/api/dus-storage') {
      void storageRequest(request, response, statePath);
    } else if (pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok', version: SERVER_VERSION });
    } else {
      staticRequest(request, response, root);
    }
  });
  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.requestTimeout = 35_000;

  const port = await listenOnAvailablePort(server, firstPort);
  const address = `http://127.0.0.1:${port}/`;
  console.log('');
  console.log('============================================================');
  console.log('                    Д У С');
  console.log('              ЛОКАЛЬНАЯ КАРТА');
  console.log('============================================================');
  console.log(`Сайт: ${address}`);
  console.log(`Данные: ${statePath}`);
  console.log('Для остановки нажмите Ctrl+C.');
  console.log('');
  if (!flags.has('no-browser')) setTimeout(() => openBrowser(address), 300);
}

main().catch((error) => {
  console.error(`ОШИБКА: ${error.message}`);
  process.exitCode = 1;
});
