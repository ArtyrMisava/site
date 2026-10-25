'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} = require('electron');
const {
  DEFAULT_PORT,
  resetAdministrator,
  startDusServer,
} = require('../server/dus-server.cjs');

const APP_TITLE = 'ДУС — локальная карта объектов';
const MAX_WORKBOOK_SIZE = 128 * 1024 * 1024;
const developmentRoot = path.resolve(__dirname, '..');
const iconPath = path.join(__dirname, 'assets', 'icon.ico');

function portableDirectory() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  }
  return app.isPackaged ? path.dirname(process.execPath) : developmentRoot;
}

const applicationDirectory = portableDirectory();
const dataDirectory = path.join(applicationDirectory, 'site-data');
const statePath = path.join(dataDirectory, 'dus-data.json');
const windowStatePath = path.join(dataDirectory, 'desktop-window.json');
let earlyStorageError = null;

try {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const dataReadme = path.join(dataDirectory, 'README_RU.txt');
  const bundledDataReadme = path.join(developmentRoot, 'site-data', 'README_RU.txt');
  if (!fs.existsSync(dataReadme) && fs.existsSync(bundledDataReadme)) {
    fs.copyFileSync(bundledDataReadme, dataReadme);
  }
  const profileDirectory = path.join(dataDirectory, 'desktop-profile');
  fs.mkdirSync(profileDirectory, { recursive: true });
  app.setPath('userData', profileDirectory);
  app.setPath('sessionData', profileDirectory);
} catch (error) {
  earlyStorageError = error;
}

app.setName('ДУС');
app.setAppUserModelId('ru.dus.offlinemap');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let serverHandle = null;
let applicationOrigin = '';
let saveWindowTimer = null;
const workbookHandles = new Map();

function webRoot() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'offline-site')]
    : [path.join(developmentRoot, 'dist'), path.join(developmentRoot, 'offline-site')];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')))
    || candidates[0];
}

function readWindowState() {
  const fallback = { width: 1440, height: 900, maximized: true };
  try {
    const value = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback;
    return {
      width: Math.max(960, Math.min(Math.round(width), 3840)),
      height: Math.max(640, Math.min(Math.round(height), 2160)),
      x: Number.isFinite(value.x) ? Math.round(value.x) : undefined,
      y: Number.isFinite(value.y) ? Math.round(value.y) : undefined,
      maximized: Boolean(value.maximized),
    };
  } catch {
    return fallback;
  }
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  try {
    const bounds = window.getNormalBounds();
    const value = {
      ...bounds,
      maximized: window.isMaximized(),
    };
    fs.writeFileSync(windowStatePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`Не удалось сохранить размер окна: ${error.message}`);
  }
}

function scheduleWindowStateSave(window) {
  if (saveWindowTimer) clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(() => {
    saveWindowTimer = null;
    saveWindowState(window);
  }, 250);
}

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    devTools: !app.isPackaged,
  };
}

function isTrustedUrl(value) {
  if (!applicationOrigin) return false;
  try {
    return new URL(value).origin === applicationOrigin;
  } catch {
    return false;
  }
}

function configureWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedUrl(url)) return { action: 'deny' };
    const target = new URL(url);
    const detachedMap = target.searchParams.get('mapWindow') === '1';
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        title: detachedMap ? 'ДУС — интерактивная карта' : APP_TITLE,
        width: detachedMap ? 1280 : 1180,
        height: detachedMap ? 820 : 760,
        minWidth: 760,
        minHeight: 520,
        backgroundColor: '#eeeee9',
        autoHideMenuBar: false,
        icon: iconPath,
        webPreferences: secureWebPreferences(),
      },
    };
  });

  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());

  contents.on('did-create-window', (window) => {
    configureWebContents(window.webContents);
  });

  if (app.isPackaged) {
    contents.on('before-input-event', (event, input) => {
      const devToolsShortcut = input.key === 'F12'
        || (input.control && input.shift && input.key.toLocaleLowerCase() === 'i');
      if (devToolsShortcut) event.preventDefault();
    });
  }
}

function focusedWindow() {
  return BrowserWindow.getFocusedWindow() || mainWindow;
}

async function openDataDirectory() {
  const errorMessage = await shell.openPath(dataDirectory);
  if (errorMessage) {
    await dialog.showMessageBox(focusedWindow(), {
      type: 'error',
      title: 'Не удалось открыть папку',
      message: 'Windows не удалось открыть папку данных ДУС.',
      detail: errorMessage,
    });
  }
}

async function resetAdministratorFromMenu() {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : focusedWindow();
  const answer = await dialog.showMessageBox(owner, {
    type: 'warning',
    title: 'Сброс доступа администратора',
    message: 'Сбросить доступ администратора?',
    detail: [
      'Будут удалены имя, ПИН-код и код восстановления администратора.',
      'Точки, люди, машины, маршруты, линия и настройки карты сохранятся.',
    ].join('\n\n'),
    buttons: ['Отмена', 'Сбросить доступ'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (answer.response !== 1) return;

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.webContents.executeJavaScript(`
        localStorage.removeItem('lokus-admin-credentials-v1');
        sessionStorage.removeItem('lokus-admin-session-v1');
      `);
      for (const window of BrowserWindow.getAllWindows()) {
        if (window !== mainWindow) window.close();
      }
      const storageUpdated = await mainWindow.webContents.executeJavaScript(`
        (() => {
          const keys = [
            'lokus-map-items-v1',
            'dus-map-coordinate-version',
            'dus-map-view-link-v1',
            'dus-map-layer-mode-v1',
            'dus-frontline-layer-v1'
          ];
          const entries = {};
          for (const key of keys) {
            const value = localStorage.getItem(key);
            if (value !== null) entries[key] = value;
          }
          return fetch('/api/dus-storage', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries }),
            cache: 'no-store'
          }).then((response) => response.ok);
        })()
      `);
      if (!storageUpdated) throw new Error('Не удалось обновить файл данных.');
    }

    resetAdministrator(statePath);
    await dialog.showMessageBox(owner, {
      type: 'info',
      title: 'Доступ сброшен',
      message: 'Доступ администратора успешно сброшен.',
      detail: 'Создайте нового администратора после перезапуска интерфейса.',
      buttons: ['Продолжить'],
      defaultId: 0,
      noLink: true,
    });
    mainWindow?.webContents.reloadIgnoringCache();
  } catch (error) {
    await dialog.showMessageBox(owner, {
      type: 'error',
      title: 'Ошибка сброса',
      message: 'Не удалось сбросить доступ администратора.',
      detail: error.message,
    });
  }
}

function installApplicationMenu() {
  const template = [
    {
      label: 'Приложение',
      submenu: [
        {
          label: 'Открыть папку данных',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => { void openDataDirectory(); },
        },
        {
          label: 'Сбросить доступ администратора…',
          click: () => { void resetAdministratorFromMenu(); },
        },
        { type: 'separator' },
        { label: 'Выход', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        {
          label: 'Перезагрузить',
          accelerator: 'CmdOrCtrl+R',
          click: () => focusedWindow()?.webContents.reload(),
        },
        { type: 'separator' },
        { label: 'Увеличить масштаб', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Уменьшить масштаб', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Обычный масштаб', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'На весь экран', accelerator: 'F11', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'О программе ДУС',
          click: () => {
            void dialog.showMessageBox(focusedWindow(), {
              type: 'info',
              title: 'О программе ДУС',
              message: `ДУС ${app.getVersion()}`,
              detail: `Локальная карта объектов для Windows.\n\nДанные: ${dataDirectory}`,
              buttons: ['Закрыть'],
              defaultId: 0,
              noLink: true,
              icon: iconPath,
            });
          },
        },
      ],
    },
  ];

  if (!app.isPackaged) {
    template[1].submenu.push(
      { type: 'separator' },
      { label: 'Инструменты разработчика', accelerator: 'F12', role: 'toggleDevTools' },
    );
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedUrl(senderUrl)) throw new Error('Запрос поступил из недоверенного окна.');
}

function workbookHandle(id) {
  const handle = workbookHandles.get(id);
  if (!handle) throw new Error('Связь с Excel-файлом потеряна. Выберите файл ещё раз.');
  return handle;
}

async function readWorkbook(filePath) {
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) throw new Error('Выбранный Excel-файл больше не найден.');
  if (stats.size > MAX_WORKBOOK_SIZE) {
    throw new Error('Excel-файл слишком большой. Максимальный размер — 128 МБ.');
  }
  const data = await fs.promises.readFile(filePath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function workbookBuffer(value) {
  let data;
  if (value instanceof ArrayBuffer) {
    data = Buffer.from(value);
  } else if (ArrayBuffer.isView(value)) {
    data = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw new Error('Приложение получило некорректные данные Excel.');
  }
  if (data.byteLength > MAX_WORKBOOK_SIZE) {
    throw new Error('Excel-файл слишком большой. Максимальный размер — 128 МБ.');
  }
  return data;
}

function registerIpcHandlers() {
  ipcMain.handle('dus:excel:pick', async (event) => {
    assertTrustedSender(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Выберите книгу Excel для ДУС',
      properties: ['openFile'],
      filters: [
        { name: 'Книга Excel', extensions: ['xlsx'] },
      ],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;

    const filePath = path.resolve(result.filePaths[0]);
    if (path.extname(filePath).toLocaleLowerCase() !== '.xlsx') {
      throw new Error('Выберите файл книги Excel с расширением .xlsx.');
    }
    const id = crypto.randomUUID();
    workbookHandles.set(id, { filePath, name: path.basename(filePath) });
    return {
      id,
      name: path.basename(filePath),
      data: await readWorkbook(filePath),
    };
  });

  ipcMain.handle('dus:excel:read', async (event, id) => {
    assertTrustedSender(event);
    const handle = workbookHandle(id);
    return readWorkbook(handle.filePath);
  });

  ipcMain.handle('dus:excel:write', async (event, id, value) => {
    assertTrustedSender(event);
    const handle = workbookHandle(id);
    const data = workbookBuffer(value);
    const temporary = `${handle.filePath}.dus-${process.pid}-${Date.now()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, data);
      await fs.promises.copyFile(temporary, handle.filePath);
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    }
  });
}

async function findRunningDusServer() {
  const checks = Array.from({ length: 10 }, async (_, offset) => {
    const port = DEFAULT_PORT + offset;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(700),
      });
      if (!response.ok) return null;
      const value = await response.json();
      return value?.status === 'ok' && typeof value?.version === 'string' ? port : null;
    } catch {
      return null;
    }
  });
  const ports = await Promise.all(checks);
  return ports.find((port) => port !== null) ?? null;
}

async function createMainWindow() {
  const state = readWindowState();
  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#eeeee9',
    autoHideMenuBar: false,
    icon: iconPath,
    webPreferences: secureWebPreferences(),
  });

  configureWebContents(mainWindow.webContents);
  mainWindow.on('resize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('move', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('maximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('unmaximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.once('ready-to-show', () => {
    if (state.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });

  await mainWindow.loadURL(serverHandle.address);
}

async function bootstrap() {
  if (earlyStorageError) {
    throw new Error(`Папка данных недоступна: ${dataDirectory}\n${earlyStorageError.message}`);
  }

  const runningDusPort = await findRunningDusServer();
  if (runningDusPort !== null) {
    throw new Error(`Уже запущена другая версия ДУС на порту ${runningDusPort}. Закройте старое окно сервера или приложения и повторите запуск.`);
  }

  serverHandle = await startDusServer({
    root: webRoot(),
    statePath,
    firstPort: DEFAULT_PORT,
  });
  applicationOrigin = new URL(serverHandle.address).origin;
  registerIpcHandlers();
  installApplicationMenu();
  await createMainWindow();
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady()
    .then(bootstrap)
    .catch((error) => {
      dialog.showErrorBox(
        'ДУС — ошибка запуска',
        `${error.message}\n\nЗакройте другие окна ДУС. Если папка недоступна для записи, переместите приложение в Документы и запустите снова.`,
      );
      app.exit(1);
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      void createMainWindow();
    }
  });

  app.on('will-quit', () => {
    if (!serverHandle) return;
    void serverHandle.close().catch(() => undefined);
  });

  app.on('window-all-closed', () => app.quit());
}
