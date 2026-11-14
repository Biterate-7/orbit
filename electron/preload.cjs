'use strict';
// Runs sandboxed with contextIsolation: it exposes no Node.js or Electron APIs to the game,
// only a frozen marker so the web code can tell it is running as the desktop app.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'lostOrbitDesktop',
  Object.freeze({ platform: process.platform }),
);
