# My Golem Electron App

This project packages a Golem-based R Shiny application inside an Electron desktop app for macOS, and it also builds the images for Linux and Windows.  
It bundles the R runtime (`R.framework`) directly in the app, so no external R installation is required.

---

## Project Structure
```
/electron
  ├── app/                      # Production R script for launching Golem app
  │    └── run_app.R
  ├── main.js                   # Electron main process
  ├── resources/R.framework     # Bundled R runtime (flattened for macOS)
  ├── package.json              # Electron build configuration
  └── scripts/                  # Build helper scripts
       ├── pre_build_fix_rframework.sh
       └── post_build_check.sh
```

---

## Final Run

### Build and deploy

  - cd electron  
  - npm run prod-build

----

  - cd dist

  - /dist folder contains the dmg to be installed. 

  - install .dmg and run the app


![Image](docs/image.png)

  - Launch the app 



![Image1](docs/image-1.png)

![Image2](docs/image-2.png)

---------

## Build Process - Details

### 1. Prepare R.framework
This step flattens `R.framework` (removes `Versions/` symlinks, ensures `PrivateHeaders`, `Headers`, `Libraries`, `Resources` are real folders).
```bash
cd electron
npm run fix-rframework
```

Verify:
```bash
ls electron/resources/R.framework/Resources/bin/Rscript
```
It should exist.

---

### 2. Ensure `run_app.R` is bundled
Place your production launcher script in:
```
electron/app/run_app.R
```
It will be copied into:
```
Contents/Resources/app/run_app.R
```
inside the `.app` at build time.

---

### 3. Build the app - MAC
```bash
cd electron
npm run dist:mac
```

This runs:
- `fix-rframework`
- `electron-builder`
- `post-build-check` (verifies `Rscript` inside `.app`)

Output:
- `.dmg` and `.zip` in `electron/dist/`


## MAC - Test Packaged files / Listing

APP="dist/mac-arm64/idepGolemPackage.app"
# See what electron-builder put under Contents/Resources
ls -al "$APP/Contents/Resources"
# See if your R.framework is there (it should be)
ls -al "$APP/Contents/Resources/R.framework/Resources" || echo "R.framework missing"
# Look for run_app.R anywhere inside Resources
find "$APP/Contents/Resources" -name Rscript -maxdepth 5
-------

# Show where things landed
ls -al "$APP/Contents/Resources/app/run_app.R"
ls -al "$APP/Contents/Resources/R.framework/Resources/Rscript"

# Now launch the packaged R with your packaged run_app.R
"$APP/Contents/Resources/R.framework/Resources/Rscript" \
  "$APP/Contents/Resources/app/run_app.R" \
  --port 7777 --host 127.0.0.1

# Test application from Terminal
APP="dist/mac-arm64/idepGolemPackage.app" 
"./$APP/Contents/MacOS/idepGolemPackage"
