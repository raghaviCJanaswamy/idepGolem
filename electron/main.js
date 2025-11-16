// main.js
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const spawn = require('cross-spawn');

const isDev = !app.isPackaged;

let rProc = null;
let win = null;

// ---------- log file in userData ----------
let logPath;
(function initLogging() {
  try {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
    logPath = path.join(dir, `golem-electron-debug-${stamp}.log`);
    fs.appendFileSync(logPath, `\n=== Launch ${new Date().toISOString()} ===\n`);
  } catch {
    logPath = path.join(app.getPath('temp'), 'golem-electron-fallback.log');
    try { fs.appendFileSync(logPath, `\n=== Launch (fallback) ===\n`); } catch {}
  }
})();
const log = (m) => { try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${m}\n`); } catch {} };

// ---- changed: add isQuitting guard and use app.exit instead of app.quit ----
let isQuitting = false;
function safeQuit(code = 0) {
  if (isQuitting) return;            // prevent re-entry
  isQuitting = true;

  try {
    if (rProc && !rProc.killed) {
      rProc.kill('SIGTERM');
      log('Killed R process with SIGTERM');
    }
  } catch (e) {
    log(`Kill error: ${e}`);
  }

  // IMPORTANT: app.exit() bypasses before-quit/quit/window-all-closed handlers,
  // avoiding recursive quit loops.
  try {
    log(`Calling app.exit(${code})`);
    app.exit(code);
  } catch (e) {
    log(`app.exit error: ${e}`);
    process.exit(code);
}
}
// ---------------------------------------------------------------------------

// ---------- find vendored/system Rscript ----------
function preferRscript() {
  const resPath = process.resourcesPath || '.';
  log(`resourcesPath: ${resPath}`);

  const vendoredBase = path.join(resPath, 'r-runtime');

  if (process.platform === 'darwin') {
    const frameworkR = path.join(resPath, 'R.framework', 'Resources', 'bin', 'Rscript');
    log(`probe mac(framework): ${frameworkR} -> ${fs.existsSync(frameworkR)}`);
    if (fs.existsSync(frameworkR)) return frameworkR;

    const mac = path.join(vendoredBase, 'bin', 'Rscript');
    log(`probe mac(r-runtime): ${mac} -> ${fs.existsSync(mac)}`);
    if (fs.existsSync(mac)) return mac;
  }

  if (process.platform === 'win32') {
    const candidates = [
      path.join(vendoredBase, 'bin', 'x64', 'Rscript.exe'),
      path.join(vendoredBase, 'bin', 'Rscript.exe'),
      path.join(vendoredBase, 'bin', 'x64', 'Rscript'),
      path.join(vendoredBase, 'bin', 'Rscript'),
    ];
    for (const p of candidates) {
      const ok = fs.existsSync(p);
      log(`probe win: ${p} -> ${ok}`);
      if (ok) return p;
    }
  }

  if (process.platform === 'linux') {
    const lin = path.join(vendoredBase, 'bin', 'Rscript');
    log(`probe linux: ${lin} -> ${fs.existsSync(lin)}`);
    if (fs.existsSync(lin)) return lin;
  }

  log('Falling back to plain "Rscript" (dev/system PATH)');
  return 'Rscript';
}

async function createWindow() {
  const rScriptFile = isDev
    ? path.join(__dirname, 'app', 'run_app.R')
    : path.join(process.resourcesPath, 'app', 'run_app.R');

  const rPath = preferRscript();
  log(`Rscript Path: ${rPath}`);
  log(`run_app.R: ${rScriptFile}`);

  if (!isDev && !fs.existsSync(rPath)) {
    const base = path.dirname(path.dirname(rPath));
    let listing = '(bin folder missing)';
    const binDir = path.dirname(rPath);
    try { listing = fs.existsSync(binDir) ? fs.readdirSync(binDir).join('\n') : listing; } catch {}
    const msg = `Rscript not found at:\n${rPath}\n\nBin listing:\n${listing}\n\nExpected r-runtime base:\n${base}`;
      log(msg);
      dialog.showErrorBox('Rscript not found', msg);
    return safeQuit(1);
    }

  if (!fs.existsSync(rScriptFile)) {
    const msg = `run_app.R not found at:\n${rScriptFile}\n\nPlace it under extraResources "app/run_app.R".`;
    log(msg);
    dialog.showErrorBox('Missing run_app.R', msg);
    return safeQuit(1);
  }

  const urlRegex = /(Listening|Running)\s+on\s+(https?:\/\/[0-9.:]+(?:\/[^\s]*)?)/i;
  const rArgs = [rScriptFile, '--port', '0', '--host', '127.0.0.1'];

  const extraEnv = {};
  if (!isDev && process.platform === 'darwin') {
    const frameworkHome = path.join(process.resourcesPath, 'R.framework', 'Resources');
    const unifiedHome = path.join(process.resourcesPath, 'r-runtime');
    if (fs.existsSync(frameworkHome)) {
      extraEnv.R_HOME = frameworkHome;
      extraEnv.PATH = [path.join(frameworkHome, 'bin'), process.env.PATH || ''].join(path.delimiter);
    } else {
      extraEnv.R_HOME = unifiedHome;
      extraEnv.PATH = [path.join(unifiedHome, 'bin'), process.env.PATH || ''].join(path.delimiter);
    }
  }

  if (!isDev && process.platform === 'win32') {
    const base = path.join(process.resourcesPath, 'r-runtime');
    extraEnv.R_HOME = base;
    extraEnv.PATH = [
      path.join(base, 'bin'),
      path.join(base, 'bin', 'x64'),
      path.join(base, 'bin'),
      process.env.PATH || ''
    ].join(path.delimiter);
    extraEnv.R_LIBS_USER = path.join(base, 'library');
    extraEnv.R_LIBS_SITE = extraEnv.R_LIBS_USER;
    extraEnv.R_ARCH = '/x64';
  }

  if (!isDev && process.platform === 'linux') {
    const base = path.join(process.resourcesPath, 'r-runtime');
    extraEnv.R_HOME = base;
    extraEnv.LD_LIBRARY_PATH = [
      path.join(base, 'lib'),
      process.env.LD_LIBRARY_PATH || ''
    ].join(path.delimiter);
    extraEnv.PATH = [
      path.join(base, 'bin'),
      process.env.PATH || ''
    ].join(path.delimiter);
  }
  log(`Env extras: ${JSON.stringify(extraEnv)}`);

  try {
    rProc = spawn(rPath, rArgs, { env: { ...process.env, ...extraEnv } });
  } catch (err) {
    log(`Failed to spawn R: ${err}`);
    dialog.showErrorBox('Rscript Error', `Could not start Rscript.\n${String(err)}`);
    return safeQuit(1);
  }

  let targetURL = null;

  rProc.on('error', (e) => {
    log(`R process error: ${e?.message || e}`);
    dialog.showErrorBox('Rscript Spawn Error', String(e));
    safeQuit(1);
  });

  rProc.stdout.on('data', (buf) => {
    const s = buf.toString();
    log(`R stdout: ${s.trim()}`);
    const m = s.match(urlRegex);
    if (m && !targetURL) {
      targetURL = m[2];

      win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      });

      win.loadURL(targetURL).catch(err => {
        dialog.showErrorBox('Load Failed', `Could not load ${targetURL}\n${err?.message || err}`);
        safeQuit(1);
      });

      // optional: only exit the whole app if the R process has already died
      win.on('closed', () => safeQuit(0));
    }
  });

  rProc.stderr.on('data', d => log(`R stderr: ${d.toString().trim()}`));
  rProc.on('close', code => { log(`R exited with code ${code}`); safeQuit(code || 0); });

  setTimeout(() => {
    if (!targetURL) {
      log('Timeout: Shiny did not start in 120s');
      dialog.showErrorBox('Startup Timeout', `App did not print "Listening on ..." in time.\nSee log: ${logPath}`);
      try { if (rProc && !rProc.killed) rProc.kill('SIGTERM'); } catch {}
      safeQuit(1);
    }
  }, 120000);
}

app.whenReady().then(createWindow);

// ---- changed: do NOT call safeQuit from before-quit; just mark intent ----
app.on('before-quit', () => { isQuitting = true; });

// ---- changed: use safeQuit (which uses app.exit), avoid app.quit loops ----
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') safeQuit(0);
});

// (optional) recreate on macOS when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && !isQuitting) {
    createWindow();
  }
});