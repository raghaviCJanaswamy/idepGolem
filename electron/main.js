// electron/main.js
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const spawn = require('cross-spawn');           // more robust than child_process.spawn on Windows
const isDev = require('electron-is-dev');
const waitOn = require('wait-on');

let logPath = path.join(app.getPath('temp'), 'golem-electron-debug.log');
fs.appendFileSync(logPath, `\n=== Launching App at ${new Date().toISOString()} ===\n`);

function preferRscript() {
  // Prefer a bundled runtime if present; otherwise fall back to PATH
  const resPath = process.resourcesPath || '.';
  const macBundled = path.join(resPath, 'resources', 'R.framework', 'Resources', 'bin', 'Rscript');
  const winBundled = path.join(resPath, 'resources', 'R-Portable', 'bin', 'Rscript.exe');
  const linuxBundled = path.join(resPath, 'resources', 'R-Linux', 'bin', 'Rscript');

  if (process.platform === 'darwin' && fs.existsSync(macBundled)) return macBundled;
  if (process.platform === 'win32' && fs.existsSync(winBundled)) return winBundled;
  if (process.platform === 'linux'  && fs.existsSync(linuxBundled)) return linuxBundled;
  return 'Rscript';
}

async function createWindow() {
  const host = '127.0.0.1';
  const port = 7777; // keep this consistent with your Rscript CLI test
  const targetURL = `http://${host}:${port}`;

  // Resolve run_app.R path: dev (from source), prod (from resources)
  const rScriptFile = isDev
    ? path.join(__dirname, 'app', 'run_app.R')           // e.g. <repo>/electron/app/run_app.R
    : path.join(process.resourcesPath, 'app', 'run_app.R'); // packaged by electron-builder

  const rPath = preferRscript();
  fs.appendFileSync(logPath, `Rscript Path: ${rPath}\n`);
  fs.appendFileSync(logPath, `run_app.R: ${rScriptFile}\n`);
  fs.appendFileSync(logPath, `Target URL: ${targetURL}\n`);

  // Spawn R with explicit flags your run_app.R expects
  const rArgs = [rScriptFile, '--port', String(port), '--host', host];

  // In prod on macOS, provide R_HOME if you bundled R.framework
  const extraEnv = {};
  if (!isDev && process.platform === 'darwin') {
    extraEnv.R_HOME = path.join(process.resourcesPath, 'resources', 'R.framework', 'Resources');
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

  rProc.stdout.on('data', d => fs.appendFileSync(logPath, `R stdout: ${d}\n`));
  rProc.stderr.on('data', d => fs.appendFileSync(logPath, `R stderr: ${d}\n`));
  rProc.on('close', code => {
    fs.appendFileSync(logPath, `R exited with code ${code}\n`);
    // Quit the app if the R backend dies
    app.quit();
  });

  // Wait for Shiny to be up, then open the window
  try {
    await waitOn({ resources: [targetURL], timeout: 60000 });
  } catch (err) {
    fs.appendFileSync(logPath, `waitOn failed: ${err}\n`);
    dialog.showErrorBox('Startup Timeout', `App did not start listening at ${targetURL}.\nSee log: ${logPath}`);
    if (rProc && !rProc.killed) { try { rProc.kill('SIGTERM'); } catch {} }
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  fs.appendFileSync(logPath, `Loading URL in window: ${targetURL}\n`);
  await win.loadURL(targetURL);

  // Helpful for first-run debugging; comment out later
  // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
