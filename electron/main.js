// electron/main.js
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const spawn = require('cross-spawn');
const isDev = require('electron-is-dev');

let logPath = path.join(app.getPath('temp'), 'golem-electron-debug.log');
fs.appendFileSync(logPath, `\n=== Launching App at ${new Date().toISOString()} ===\n`);

function preferRscript() {
  const resPath = process.resourcesPath || '.';
  const macBundled   = path.join(resPath, 'resources', 'R.framework', 'Resources', 'bin', 'Rscript');
  const winBundled   = path.join(resPath, 'resources', 'R-Portable', 'bin', 'Rscript.exe');
  const linuxBundled = path.join(resPath, 'resources', 'R-Linux', 'bin', 'Rscript');

  if (process.platform === 'darwin' && fs.existsSync(macBundled)) return macBundled;
  if (process.platform === 'win32' && fs.existsSync(winBundled)) return winBundled;
  if (process.platform === 'linux'  && fs.existsSync(linuxBundled)) return linuxBundled;
  return 'Rscript'; // dev fallback
}

async function createWindow() {
  const rScriptFile = isDev
    ? path.join(__dirname, 'app', 'run_app.R')
    : path.join(process.resourcesPath, 'app', 'run_app.R');

  const rPath = preferRscript();
  const host = '127.0.0.1';
  const preferredPort = '7777'; // requested; we still auto-detect the real one

  fs.appendFileSync(logPath, `Rscript Path: ${rPath}\n`);
  fs.appendFileSync(logPath, `run_app.R: ${rScriptFile}\n`);

  const rArgs = [rScriptFile, '--port', preferredPort, '--host', host];

  const extraEnv = {};
  if (!isDev && process.platform === 'darwin') {
    extraEnv.R_HOME = path.join(process.resourcesPath, 'resources', 'R.framework', 'Resources');
  }
  if (!isDev && process.platform === 'win32') {
    extraEnv.R_HOME = path.join(process.resourcesPath, 'resources', 'R-Portable');
    extraEnv.PATH = [
      path.join(extraEnv.R_HOME, 'bin'),
      path.join(extraEnv.R_HOME, 'bin', 'x64'),
      process.env.PATH
    ].join(path.delimiter);
  }
  if (!isDev && process.platform === 'linux') {
    extraEnv.R_HOME = path.join(process.resourcesPath, 'resources', 'R-Linux');
    extraEnv.LD_LIBRARY_PATH = [
      path.join(extraEnv.R_HOME, 'lib'),
      process.env.LD_LIBRARY_PATH || ''
    ].join(':');
    extraEnv.PATH = [
      path.join(extraEnv.R_HOME, 'bin'),
      process.env.PATH
    ].join(':');
  }
  fs.appendFileSync(logPath, `Env extras: ${JSON.stringify(extraEnv)}\n`);

  let rProc;
  try {
    rProc = spawn(rPath, rArgs, { env: { ...process.env, ...extraEnv } });
  } catch (err) {
    fs.appendFileSync(logPath, `Failed to spawn R: ${err}\n`);
    dialog.showErrorBox('Rscript Error', `Could not start Rscript.\n${String(err)}`);
    app.quit();
    return;
  }

  let win = null;
  let targetURL = null;
  const urlRegex = /Listening on (http:\/\/[0-9.:]+(?:\/[^\s]*)?)/i;

  rProc.stdout.on('data', buf => {
    const s = buf.toString();
    fs.appendFileSync(logPath, `R stdout: ${s}\n`);

    const m = s.match(urlRegex);
    if (m && !targetURL) {
      targetURL = m[1];
      fs.appendFileSync(logPath, `Detected URL: ${targetURL}\n`);

      win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      });

      win.loadURL(targetURL).catch(err => {
        dialog.showErrorBox('Load Failed', `Could not load ${targetURL}\n${err?.message || err}`);
      });
    }
  });

  rProc.stderr.on('data', d => fs.appendFileSync(logPath, `R stderr: ${d}\n`));

  rProc.on('close', code => {
    fs.appendFileSync(logPath, `R exited with code ${code}\n`);
    app.quit();
  });

  // Safety timeout if app never starts
  setTimeout(() => {
    if (!targetURL) {
      dialog.showErrorBox('Startup Timeout', `App did not print "Listening on ..." in time.\nSee log: ${logPath}`);
      if (rProc && !rProc.killed) { try { rProc.kill('SIGTERM'); } catch {} }
      app.quit();
    }
  }, 60000);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
