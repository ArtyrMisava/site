'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dusDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  pickExcelWorkbook() {
    return ipcRenderer.invoke('dus:excel:pick');
  },
  readExcelWorkbook(id) {
    return ipcRenderer.invoke('dus:excel:read', id);
  },
  writeExcelWorkbook(id, data) {
    return ipcRenderer.invoke('dus:excel:write', id, data);
  },
}));
