// scripts/afterPack-prune-lproj.js
const fs = require('fs');
const path = require('path');

module.exports = async function (context) {
  if (process.platform !== 'darwin') {
    console.log('afterPack: skipping (not macOS)');
    return;
  }

  const appOutDir = context.appOutDir; // e.g., dist/mac-arm64
  const appName = context.packager.appInfo.productFilename + '.app';
  const root = path.join(appOutDir, appName);
  const RES = path.join(root, 'Contents', 'Resources');
  const R_RES = path.join(RES, 'R.framework', 'Resources');

  // 1) prune *.lproj except Base/en
  const keep = new Set(['Base.lproj', 'en.lproj']);
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st; try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (name.endsWith('.lproj') && !keep.has(name)) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          walk(full);
        }
      }
    }
  })(root);

  // 2) prune some R docs/tests (optional, saves space)
  for (const p of ['doc', 'tests', path.join('share', 'man')]) {
    const full = path.join(R_RES, p);
    if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
  }

  // 3) verify presence of Rscript and run_app.R
  const rCandidates = [
    path.join(R_RES, 'bin', 'Rscript'),
    path.join(R_RES, 'Rscript')
  ];
  if (!rCandidates.some(p => fs.existsSync(p))) {
    throw new Error('afterPack: Rscript not found under ' + R_RES);
  }
  if (!fs.existsSync(path.join(RES, 'app', 'run_app.R'))) {
    throw new Error('afterPack: run_app.R missing (expected at Resources/app/run_app.R)');
  }

  console.log('afterPack: pruned locales/docs and verified Rscript & run_app.R');
};
