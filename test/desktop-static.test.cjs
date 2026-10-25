'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function text(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('настольная оболочка использует изолированный мост и только объявленные IPC-каналы', () => {
  const main = text('desktop/main.cjs');
  const preload = text('desktop/preload.cjs');
  const server = text('server/dus-server.cjs');
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]).sort();
  const handled = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]).sort();

  assert.deepEqual(invoked, ['dus:excel:pick', 'dus:excel:read', 'dus:excel:write']);
  assert.deepEqual(handled, invoked);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(server, /server\.listen\(port, '127\.0\.0\.1'\)/);
  assert.doesNotMatch(preload, /require\(['"]node:/);
});

test('конфигурация создаёт переносное Windows-приложение без прав администратора', () => {
  const packageJson = JSON.parse(text('package.json'));
  assert.equal(packageJson.main, 'desktop/main.cjs');
  assert.equal(packageJson.build.appId, 'ru.dus.offlinemap');
  assert.equal(packageJson.build.win.requestedExecutionLevel, 'asInvoker');
  assert.equal(packageJson.build.win.target[0].target, 'portable');
  assert.deepEqual(packageJson.build.win.target[0].arch, ['x64']);
  assert.match(packageJson.build.win.artifactName, /portable/);
  assert.ok(fs.existsSync(path.join(root, 'desktop/assets/icon.ico')));
});
