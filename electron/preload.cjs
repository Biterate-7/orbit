'use strict';
// Runs sandboxed with contextIsolation: it exposes no Node.js or Electron APIs to the game.
// The page gets a frozen marker (so it can tell it is the desktop app) and one narrow function:
// astroFetch(upstream, query), which asks the main process to query one of three fixed NASA / JPL
// services for the in-game catalogue. The main process validates both arguments.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'lostOrbitDesktop',
  Object.freeze({
    platform: process.platform,
    astroFetch: (upstream, query) => ipcRenderer.invoke('lost-orbit:astro-fetch', String(upstream), String(query)),
  }),
);
