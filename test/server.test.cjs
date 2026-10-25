'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  readState,
  resetAdministrator,
  startDusServer,
} = require('../server/dus-server.cjs');

test('локальный сервер раздаёт приложение и сохраняет разрешённые данные', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dus-server-test-'));
  const root = path.join(directory, 'offline-site');
  const statePath = path.join(directory, 'site-data', 'dus-data.json');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>ДУС</title>', 'utf8');

  const running = await startDusServer({ root, statePath, firstPort: 0 });
  try {
    const health = await fetch(`${running.address}api/health`).then((response) => response.json());
    assert.equal(health.status, 'ok');

    const index = await fetch(running.address);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /ДУС/);

    const denied = await fetch(`${running.address}api/dus-storage`, {
      headers: { Origin: 'http://example.invalid' },
    });
    assert.equal(denied.status, 403);

    const entries = {
      'lokus-admin-credentials-v1': JSON.stringify({ username: 'admin', pinHash: 'hash' }),
      'lokus-map-items-v1': JSON.stringify([{ id: 'point-1' }]),
      'dus-frontline-layer-v1': JSON.stringify({ segments: [[[1, 2], [3, 4]]] }),
      'unknown-key': 'must not be saved',
    };
    const saved = await fetch(`${running.address}api/dus-storage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    assert.equal(saved.status, 200);

    const stored = await fetch(`${running.address}api/dus-storage`).then((response) => response.json());
    assert.equal(stored.initialized, true);
    assert.equal(stored.entries['lokus-map-items-v1'], entries['lokus-map-items-v1']);
    assert.equal(stored.entries['dus-frontline-layer-v1'], entries['dus-frontline-layer-v1']);
    assert.equal(stored.entries['unknown-key'], undefined);
  } finally {
    await running.close();
  }

  resetAdministrator(statePath);
  const { state } = readState(statePath);
  assert.equal(state.entries['lokus-admin-credentials-v1'], undefined);
  assert.match(state.entries['lokus-map-items-v1'], /point-1/);
  assert.match(state.entries['dus-frontline-layer-v1'], /segments/);
  fs.rmSync(directory, { recursive: true, force: true });
});
