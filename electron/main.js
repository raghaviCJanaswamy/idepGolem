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
  // Dev: keep a couple of common layouts
  if (isDev) {
    return [
      path.join(__dirname, 'app', 'run_app.R'),
      path.join(__dirname, '..',  'app', 'run_app.R'),
    ];
  }
  // Prod: we copy to "<Resources>/resources/app/run_app.R"
  const R = process.resourcesPath;
  return [
    path.join(R, 'app', 'run_app.R'),              // if you switch to: "app"
  ];  
}

// Decide R runtime & env by platform. For now, mac is primary.
// For Windows/Linux, leave stubs + dual naming so you can choose folder names later.
function getRuntime() {
  const rp = app.isPackaged ? process.resourcesPath : __dirname;

  if (process.platform === 'darwin') {
    // macOS: flattened R.framework lives under resources/R.framework/Resources
    const R_RES = path.join(rp, 'resources', 'R.framework', 'Resources');
    const rscriptCandidates = [
      path.join(R_RES, 'Rscript'),
      path.join(R_RES, 'bin', 'Rscript'),
    ];
    const rscript = rscriptCandidates.find(fs.existsSync) || 'Rscript';
      return {
        rscript,
        env: {
          R_HOME: R_RES,
          DYLD_FALLBACK_LIBRARY_PATH: path.join(R_RES, 'lib'),
          PATH: `${path.join(R_RES, 'bin')}:${R_RES}:${process.env.PATH || ''}`,
        },
      };
    }

  if (process.platform === 'win32') {
    // Future: choose one folder name and keep it consistent in extraResources
    const roots = [
      path.join(rp, 'resources', 'R.win'),
      path.join(rp, 'resources', 'R-Portable'),
    ];
    const R_ROOT = roots.find(fs.existsSync);
    const bin = R_ROOT ? path.join(R_ROOT, 'bin', 'x64') : null;
    const rscript = bin ? path.join(bin, 'Rscript.exe') : 'Rscript.exe';
    return {
      rscript,
      env: R_ROOT ? { R_HOME: R_ROOT, PATH: `${bin};${path.join(R_ROOT, 'bin')};${process.env.PATH || ''}` } : {},
    };
  }

  // linux
  {
    const roots = [
      path.join(rp, 'resources', 'R.linux'),
      path.join(rp, 'resources', 'R-Linux'),
    ];
    const R_ROOT = roots.find(fs.existsSync);
    const bin = R_ROOT ? path.join(R_ROOT, 'bin') : null;
    const rscript = bin ? path.join(bin, 'Rscript') : 'Rscript';
        return {
          rscript,
          env: R_ROOT ? {
            R_HOME: R_ROOT,
            LD_LIBRARY_PATH: [
              path.join(R_ROOT, 'lib'),
              process.env.LD_LIBRARY_PATH || '',
            ].filter(Boolean).join(':'),
            PATH: `${bin}:${process.env.PATH || ''}`,
          } : {},
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

  // locate run_app.R
  const rEntry = REntryCandidates().find(fs.existsSync);
  if (!rEntry) {
    dialog.showErrorBox('Missing run_app.R',
      `Could not find run_app.R.\nLooked in:\n${REntryCandidates().join('\n')}\n\nLog: ${logPath}`);
    app.quit();
    return;
  }

  const { rscript, env } = getRuntime();
  const mergedEnv = { ...process.env, ...env };

  log(`=== Launch ${new Date().toISOString()} ===`);
  log(`logPath: ${logPath}`);
  log(`isDev: ${isDev}`);
  log(`Rscript: ${rscript}`);
  log(`run_app.R: ${rEntry}`);
  log(`targetURL: ${targetURL}`);
  log(`env extras: ${JSON.stringify(env)}`);

  // If your run_app.R accepts flags; otherwise switch to positional args
  const rArgs = [rEntry, '--port', String(port), '--host', host];

  try {
    rProc = spawn(rscript, rArgs, { env: mergedEnv });
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
        await waitOn({ resources: [targetURL], timeout: 60000, validateStatus: s => s === 200 });
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