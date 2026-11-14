'use strict';
// Electron main process for the Lost Orbit Windows desktop build.
//
// It loads the unmodified Vite production build (dist/) inside a locked-down window:
//   - the renderer has no Node.js access (nodeIntegration off, contextIsolation on, sandbox on);
//   - dist/ is served from a private app:// origin instead of file://, so the game gets a real,
//     stable origin for localStorage saves and a strict Content-Security-Policy header;
//   - navigation, pop-ups, webviews and permission prompts are all refused (the game needs none).

const { app, BrowserWindow, Menu, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const APP_USER_MODEL_ID = 'com.lostorbit.game'; // keep in sync with appId in electron-builder.yml
const SCHEME = 'app';
const HOST = 'lost-orbit';
const START_URL = `${SCHEME}://${HOST}/index.html`;
const RENDERER_DIR = path.resolve(__dirname, '..', 'dist');

// The game makes no network requests: sprites, audio and fonts are generated or bundled.
// 'unsafe-inline' styles are needed for React style={...} attributes.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

// Must run before the app is ready. "standard" + "secure" give app:// a normal origin with
// working localStorage, ES modules and relative URL resolution, like https://.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** Serves files from dist/ (inside app.asar when packaged) for app://lost-orbit/... requests. */
async function serveRendererFile(request) {
  let pathname;
  try {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.resolve(RENDERER_DIR, `.${pathname}`);
  if (!filePath.startsWith(RENDERER_DIR + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const body = await fs.readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function isAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${SCHEME}:` && url.host === HOST;
  } catch {
    return false;
  }
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'Lost Orbit',
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    center: true,
    show: false,
    backgroundColor: '#04050b', // matches the game's theme colour: no white flash on start
    autoHideMenuBar: true,
    // Packaged builds take the icon embedded in the .exe; this only matters for `npm run electron:start`.
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  // Keep the window/taskbar title as the application name rather than the page <title>.
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Desktop-only shortcuts. The game's own keys (WASD, arrows, Space, Shift, Esc, P) are untouched.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !mainWindow) return;
    const toggleFullScreen = input.key === 'F11' || (input.alt && input.key === 'Enter');
    if (toggleFullScreen) {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (!app.isPackaged && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.loadURL(START_URL);
}

// Lock down every web contents: no navigation away from the game, no pop-ups, no webviews.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// One running copy at a time, so two windows can't race each other writing the save data.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setAppUserModelId(APP_USER_MODEL_ID);

  app.whenReady().then(() => {
    protocol.handle(SCHEME, serveRendererFile);
    // The game needs no camera, microphone, notifications, geolocation, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // No File/Edit/View menu: it would add reload and zoom shortcuts that can interrupt a run.
    Menu.setApplicationMenu(null);
    createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
