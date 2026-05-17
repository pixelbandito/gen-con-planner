// Electron main process for the Gen Con Planner desktop app.
//
// Architecture (see docs/plans/2026-05-17-desktop-app-feasibility.md §4):
// the main process starts the bundled GenCon proxy on a localhost port,
// serves the built SPA (dist/) from that *same* origin, and opens a window
// pointed at it. Because the renderer is served from http://127.0.0.1:<port>/,
// its existing absolute `fetch('/api/gencon/...')` calls resolve to the same
// origin — so `src/` needs zero changes and the renderer stays plain web
// content (contextIsolation on, nodeIntegration off).
//
// This file is CommonJS (.cjs) on purpose: it must load regardless of the
// package's `"type": "module"`. The proxy server itself is ESM
// (server/gencon-server.mjs) and is loaded below via a dynamic import().

const path = require('node:path');
const { app, BrowserWindow, Menu, dialog } = require('electron');

// Port 0 asks the OS for a free loopback port; the actual assigned port is read
// back from `server.address()` after `listening`. This avoids the
// port-collision failure mode a fixed port would have on a busy machine.
const PORT = 0;
const HOST = '127.0.0.1';

/** The running HTTP server (proxy + static SPA), or null before startup. */
let httpServer = null;
/** The actual OS-assigned port the embedded server is listening on. */
let serverPort = null;
/** The main application window, or null when none is open. */
let mainWindow = null;

/**
 * Resolve the read-only bundled events.json seed.
 * - Packaged: shipped as an extra resource under process.resourcesPath.
 * - Dev: the repo's public/data/events.json (one dir up from electron/).
 */
function resolveBundlePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'data', 'events.json');
  }
  return path.join(__dirname, '..', 'public', 'data', 'events.json');
}

/**
 * Resolve the directory of the built SPA to serve.
 * - Packaged: dist/ shipped as an extra resource under process.resourcesPath.
 * - Dev: the repo's dist/ (produced by `npm run build:desktop`).
 */
function resolveStaticDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'dist');
  }
  return path.join(__dirname, '..', 'dist');
}

/**
 * Start the embedded GenCon proxy + static-SPA server, bound to loopback only.
 * Returns the listening http.Server.
 */
async function startServer() {
  // server/gencon-server.mjs is ESM; load it from this CommonJS file via a
  // dynamic import().
  const { startGenconServer } = await import('../server/gencon-server.mjs');

  const cacheDir = path.join(app.getPath('userData'), 'cache');
  const bundlePath = resolveBundlePath();
  const staticDir = resolveStaticDir();

  const server = startGenconServer({
    port: PORT,
    host: HOST, // loopback only — never exposed beyond this machine.
    cacheDir,
    bundlePath,
    staticDir,
  });

  // Resolve once the socket is actually listening so the window only loads a
  // URL that is ready to answer.
  await new Promise((resolveListening, rejectListening) => {
    server.once('listening', resolveListening);
    server.once('error', rejectListening);
  });

  const addr = server.address();
  serverPort = typeof addr === 'object' && addr ? addr.port : null;
  if (serverPort === null) {
    throw new Error('embedded server started but reported no address/port');
  }
  console.log(
    `[gencon] embedded server listening on http://${HOST}:${serverPort}/`,
  );
  console.log(`[gencon] cacheDir=${cacheDir}`);
  console.log(`[gencon] bundlePath=${bundlePath}`);
  console.log(`[gencon] staticDir=${staticDir}`);
  return server;
}

/** Create the main application window and load the embedded SPA. */
function createWindow() {
  // serverPort is set by startServer() before this is ever called.
  const appOrigin = `http://${HOST}:${serverPort}`;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Gen Con Planner',
    webPreferences: {
      // The renderer is plain web content and reaches the backend over HTTP;
      // it needs no Node access. These are the secure defaults.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const { webContents } = mainWindow;

  // Defense-in-depth: the renderer is trusted local content, but block any
  // attempt to open new windows or navigate away from the embedded origin
  // (e.g. an injected link), so the app can never become a generic browser.
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${appOrigin}/`) && url !== appOrigin) {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(`${appOrigin}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Stop the embedded HTTP server, if running. */
function stopServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

app.whenReady().then(async () => {
  // A minimal standard application menu (Quit / Edit / View / Window).
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));

  try {
    httpServer = await startServer();
  } catch (err) {
    console.error('[gencon] failed to start embedded server:', err);
    // Surface the failure so a packaged-app crash is diagnosable rather than a
    // silent quit (the user has no console).
    dialog.showErrorBox(
      'Gen Con Planner could not start',
      'The app could not start its local data service and will now quit.\n\n' +
        `Details: ${err && err.message ? err.message : String(err)}`,
    );
    app.quit();
    return;
  }

  createWindow();

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (acceptable for v1 on all platforms,
// including macOS).
app.on('window-all-closed', () => {
  app.quit();
});

// Tear the embedded server down as the app exits.
app.on('before-quit', () => {
  stopServer();
});

/**
 * Build a minimal application menu template. On macOS the leading app menu
 * (with Quit) is added automatically; on other platforms a File > Quit entry
 * is included so the app is always quittable.
 */
function buildMenuTemplate() {
  const isMac = process.platform === 'darwin';
  return [
    ...(isMac
      ? [{ role: 'appMenu' }]
      : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}
