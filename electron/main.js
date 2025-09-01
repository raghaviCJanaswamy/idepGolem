// electron/main.js -------
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const spawn = require('cross-spawn');          // keeps Win happy later
const isDev = require('electron-is-dev');
const waitOn = require('wait-on');

let win;
let rProc;
// ---------- logging ----------
const logPath = path.join(app.getPath('temp'), 'golem-electron-debug.log');
function log(...args) {
  try { fs.appendFileSync(logPath, args.join(' ') + '\n'); } catch {}
}

// ---------- path helpers ----------
function REntryCandidates() {
  if (isDev) {
    return [
      path.join(__dirname, 'app', 'run_app.R'),
      path.join(__dirname, '..',  'app', 'run_app.R'),
    ];
  }
  const R = process.resourcesPath;
  return [
    path.join(R, 'app', 'run_app.R'),       
    path.join(R, 'resources', 'app', 'run_app.R'), // fallback if you ever switch // if you switch to: "app"
  ];  
}// Decide R runtime & env by platform. mac is primary; win/linux stubs kept for future.
function getRuntime() {
  const rp = app.isPackaged ? process.resourcesPath : __dirname;

  if (process.platform === 'darwin') {
    // <App>.app/Contents/Resources/R.framework/Resources
    const candidates = [
      path.join(rp, 'R.framework', 'Resources', 'Rscript'),
      path.join(rp, 'R.framework', 'Resources', 'bin', 'Rscript'),
      // tolerate older “double resources” layouts:
      path.join(rp, 'resources', 'R.framework', 'Resources', 'Rscript'),
      path.join(rp, 'resources', 'R.framework', 'Resources', 'bin', 'Rscript'),
    ];
    const rscript = candidates.find(fs.existsSync);
    if (!rscript) {
      log(`[FATAL] No Rscript; process.resourcesPath=${rp}\nChecked:\n${candidates.join('\n')}`);
      dialog.showErrorBox('Rscript Not Found',
        `Could not locate bundled Rscript.\nresourcesPath: ${rp}\nChecked:\n${candidates.join('\n')}\n`);
      app.quit();
      return undefined;
    }

    // R_HOME = Resources dir (strip /bin if needed)
    const R_RES = rscript.includes('/bin/')
      ? path.dirname(path.dirname(rscript))
      : path.dirname(rscript);

    return {
      rscript,
      env: {
        R_HOME: R_RES,
        DYLD_FALLBACK_LIBRARY_PATH: path.join(R_RES, 'lib'),
        PATH: `${path.join(R_RES, 'bin')}:${R_RES}:${process.env.PATH || ''}`,
      },
    };

  // WIn32
  }

  if (process.platform === 'win32') {
    // Future: choose one folder name and keep it consistent in extraResources
      const tryRoots = [
      path.join(rp, 'R.win'),
      path.join(rp, 'resources', 'R.win'),
      path.join(rp, 'R-Portable'),
      path.join(rp, 'resources', 'R-Portable'),
    ];
    const R_ROOT = tryRoots.find(fs.existsSync);
    const bin64  = R_ROOT ? path.join(R_ROOT, 'bin', 'x64') : null;
    const rscript = (bin64 && fs.existsSync(path.join(bin64, 'Rscript.exe')))
      ? path.join(bin64, 'Rscript.exe')
      : (R_ROOT ? path.join(R_ROOT, 'bin', 'Rscript.exe') : 'Rscript.exe');
    return {
      rscript,
      env: R_ROOT ? {
        R_HOME: R_ROOT,
        PATH: [
          bin64,
          path.join(R_ROOT, 'bin'),
          process.env.PATH || ''
        ].filter(Boolean).join(';')
      } : {}
    };
  }

  // linux
  {
      const tryRoots = [
      path.join(rp, 'R.linux'),
      path.join(rp, 'resources', 'R.linux'),
      path.join(rp, 'R-Linux'),
      path.join(rp, 'resources', 'R-Linux'),
    ];
    const R_ROOT = tryRoots.find(fs.existsSync);
    const bin    = R_ROOT ? path.join(R_ROOT, 'bin') : null;
    const rscript = (bin && fs.existsSync(path.join(bin, 'Rscript')))
      ? path.join(bin, 'Rscript')
      : 'Rscript';
    return {
      rscript,
      env: R_ROOT ? {
        R_HOME: R_ROOT,
        LD_LIBRARY_PATH: [
          path.join(R_ROOT, 'lib'),
          process.env.LD_LIBRARY_PATH || ''
        ].filter(Boolean).join(':'),
        PATH: [
          bin,
          process.env.PATH || ''
        ].filter(Boolean).join(':')
      } : {}
    };

  }
}

// ---------- single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

function safeKill() {
  try {
    if (rProc && !rProc.killed) {
      if (process.platform === 'win32') rProc.kill('SIGTERM');
      else rProc.kill('SIGINT');
    }
  } catch {}
}
async function createWindow() {
  const host = '127.0.0.1';
  const port = Number(process.env.APP_PORT || 7777);
  const targetURL = `http://${host}:${port}`;
  // --- packaged code location ---
    const RESOURCES_DIR = process.resourcesPath;                  // .../Contents/Resources
    const APP_DIR       = path.join(RESOURCES_DIR, 'app');        // read-only bundled assets
  // --- prefer the folder the app was launched from (Terminal); fallback to userData when not writable ---
  const LAUNCH_DIR = process.cwd();
  const forceDir   = process.env.IDEP_DATA_DIR || process.env.IDEP_DATABASE; // explicit override if provided
  function isWritableDir(p) {
    try { fs.accessSync(p, fs.constants.W_OK); return fs.statSync(p).isDirectory(); } catch { return false; }
  }
  let DATA_PARENT;
  if (forceDir) {
    DATA_PARENT = path.resolve(forceDir);
  } else if (LAUNCH_DIR && LAUNCH_DIR !== '/' && isWritableDir(LAUNCH_DIR)) {
    DATA_PARENT = path.join(LAUNCH_DIR, 'idep'); // keep data next to where user launched from
  } else {
    DATA_PARENT = path.join(app.getPath('userData'), 'idep'); // ~/Library/Application Support/<AppName>/idep
  }
    fs.mkdirSync(DATA_PARENT, { recursive: true });
  
  // locate run_app.R
  const rEntry = REntryCandidates().find(fs.existsSync);
  if (!rEntry) {
    dialog.showErrorBox('Missing run_app.R',
      `Could not find run_app.R.\nLooked in:\n${REntryCandidates().join('\n')}\n\nLog: ${logPath}`);
    app.quit();
    return;
  }
  const runtime = getRuntime();
  if (!runtime) return;
  const { rscript, env } = runtime;
    // Env we inject for R:
  // - IDEP_DATABASE: parent of <db_ver>, R code appends version; we point it at a writable place
  // - IDEP_APP_DIR: where packaged assets live (handy if code needs it)
  // - IDEP_DATA_DIR: same writable place (for caches/DB/etc.)
  const extraEnv = {
    IDEP_DATABASE: DATA_PARENT,
    IDEP_APP_DIR: APP_DIR,
    IDEP_DATA_DIR: DATA_PARENT,
  };

  log(`=== Launch ${new Date().toISOString()} ===`);
  log(`process.resourcesPath = ${RESOURCES_DIR}`);
  log(`LAUNCH_DIR = ${LAUNCH_DIR}`);
  log(`DATA_PARENT (chosen) = ${DATA_PARENT}`);
  if (forceDir) log(`(override) IDEP_DATA_DIR/IDEP_DATABASE = ${forceDir}`);
  log(`APP_DIR = ${APP_DIR}`);
  log(`Rscript = ${rscript}`);
  log(`run_app.R = ${rEntry}`);
  log(`targetURL = ${targetURL}`);

  // If your run_app.R accepts flags; otherwise switch to positional args
  const rArgs = [rEntry, '--port', String(port), '--host', host];

  try {
    // IMPORTANT: merge extraEnv, and run with cwd = DATA_PARENT so "./<db_ver>" fallback is safe
    rProc = spawn(rscript, rArgs, {
      env: { ...process.env, ...env, ...extraEnv },
      cwd: DATA_PARENT,
    });
  } catch (err) {
    log(`Failed to spawn R: ${String(err)}`);
    dialog.showErrorBox('Rscript Error', `Could not start Rscript.\n${String(err)}\nLog: ${logPath}`);
    app.quit();
    return;
      }
    
      rProc.stdout.on('data', d => log(`[R stdout] ${d.toString()}`));
      rProc.stderr.on('data', d => log(`[R stderr] ${d.toString()}`));
      rProc.on('close', code => {
        log(`R exited with code ${code}`);
        if (!app.isQuitting) app.quit();
      });
    
      // wait for Shiny/Golem to come up
      try {
    await waitOn({ resources: [targetURL], timeout: 60000, validateStatus: s => s >= 200 && s < 400 });
      } catch (err) {
        log(`waitOn failed: ${String(err)}`);
        dialog.showErrorBox('Startup Timeout', `App did not start at ${targetURL} within 60s.\nSee log: ${logPath}`);
        safeKill();
        app.quit();
        return;
      }
    
      win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          // preload: path.join(__dirname, 'preload.js'),
        },
      });
    
      log(`Loading ${targetURL}`);
      await win.loadURL(targetURL);
      // win.webContents.openDevTools({ mode: 'detach' });
    }
    
    app.whenReady().then(createWindow);
    app.on('before-quit', () => { app.isQuitting = true; safeKill(); });
    app.on('window-all-closed', () => { app.quit(); });