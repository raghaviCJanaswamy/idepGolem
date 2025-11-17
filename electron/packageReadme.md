
# Packaging & Distribution Guide (Windows, Electron + R)

This document explains how the iDEP Electron app is built, how the embedded R runtime is packaged, and how the CI workflow produces a distributable Windows installer.

---

## 1. Overview

The app is a desktop wrapper around the **iDEP Shiny application**:

- **Frontend**: Electron (Node 20, electron-builder)
- **Backend**: Embedded R (`runtime/R.win`) running `idepGolem::run_app()`
- **Target OS**: Windows 64-bit (`windows-latest` on GitHub Actions)
- **Bundled R**: Full R runtime mirrored into `electron/runtime/R.win`
- **Key extras**:
  - GitHub-installed **ottoPlots** package
  - Bioconductor / CRAN dependencies from the `idepGolem` DESCRIPTION
  - Caching & lazy loading of **demo data** tarball (`data113`)

The **final output** is a Windows installer / executable produced by `electron-builder` under `electron/dist/`.

---

## 2. Repository Layout (relevant for packaging)

High-level structure (only relevant parts):

```text
.
├─ electron/                # Electron app (package.json)
│  ├─ main.js               # Electron main process (spawns R)
│  ├─ runtime/R.win/        # Bundled R (populated in CI)
│  ├─ app/                  # Staged golem app (R/, app.R, DESCRIPTION)
│  └─ dist/                 # Built installers (CI artifact)
├─ R/                       # R package source (part of idepGolem)
├─ DESCRIPTION              # idepGolem DESCRIPTION (if at repo root)
└─ .github/workflows/
   └─ build-windows.yml     # Windows build pipeline
```

The CI workflow auto-detects:

- `PACKAGE_DIR` – directory containing `package.json` (`electron/` or repo root)
- `PKG_SRC` – R package source directory containing `DESCRIPTION` with `Package: idepGolem`

---

## 3. Prerequisites

### Local (manual builds)

- Node.js 20
- npm
- R 4.4.1
- Rtools 44 (for Windows)
- `tar` on PATH (for `R CMD build/INSTALL`)
- Git (for `remotes::install_github()`)

### CI

The workflow uses:

- `actions/checkout@v4`
- `actions/setup-node@v4`
- `r-lib/actions/setup-r@v2`
- `electron-builder@26.0.12`

---

## 4. R Runtime Packaging (`runtime/R.win`)

The CI stages a complete R runtime into `runtime/R.win` inside the Electron app directory.

Key step (simplified):

```pwsh
$RHOME = & Rscript -e "cat(R.home())"
$dst   = Join-Path $env:PACKAGE_DIR "runtime\R.win"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy "$RHOME" "$dst" /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:2
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
$global:LASTEXITCODE = 0
```

Result (inside `electron/`):

```text
runtime/
  R.win/
    bin/
      R.exe
      Rscript.exe
    library/
    etc/
    ...
```

`main.js` → `getRuntime()` locates `runtime/R.win` and configures:

- `R_HOME` → `runtime/R.win`
- `R_LIBS` / `R_LIBS_USER` → `runtime/R.win/library`
- `PATH` → includes `runtime/R.win/bin`

The app can run without a system-wide R installation.

---

## 5. Installing R Packages into the Bundled Library

All required R packages are installed **into the bundled R library** used at runtime.

### 5.1. Installing `ottoPlots` (GitHub)

The workflow installs **ottoPlots** from GitHub into the bundled library:

```pwsh
- name: Install ottoPlots into bundled R.win library
  shell: pwsh
  env:
    GITHUB_PAT: ${{ secrets.GITHUB_TOKEN }}   # helps with GitHub rate limits
  run: |
    $app = "${{ env.PACKAGE_DIR }}"
    $R   = Join-Path $app "runtime\R.winin\Rscript.exe"

    & $R -e "
      lib <- file.path(R.home(), 'library')
      dir.create(lib, showWarnings = FALSE, recursive = TRUE)
      .libPaths(lib)
      repos <- c(CRAN = 'https://cran.r-project.org')
      if (!requireNamespace('remotes', quietly = TRUE)) {
        install.packages('remotes', lib = lib, repos = repos)
      }
      remotes::install_github('espors/ottoPlots',
                              lib          = lib,
                              dependencies = TRUE,
                              upgrade      = 'never')
      cat('Installed ottoPlots into:', lib, '
')
    "
```

At startup, `electron_bootstrap.R` checks:

```r
if (!requireNamespace("ottoPlots", quietly = TRUE)) {
  stop("Package 'ottoPlots' not found in vendored library: ", paste(.libPaths(), collapse=" | "))
}
```

If missing, R exits with a clear FATAL message.

### 5.2. DESCRIPTION-based dependencies

Another CI step parses the `idepGolem` `DESCRIPTION` and installs its dependencies into the same bundled library:

- Reads `Depends` and `Imports`
- Strips version ranges, keeps package names
- Splits into:
  - CRAN packages
  - Selected Bioconductor packages (e.g. `DESeq2`, `edgeR`, `GSVA`, `hgu133plus2.db`, `ComplexHeatmap`, etc.)
- Installs:
  - CRAN packages via `install.packages()`
  - Bioconductor packages via `BiocManager::install()`
- Special-cases `ggalt` via `remotes::install_version('ggalt', version='0.4.0', ...)`

This step ensures all runtime dependencies are present in `runtime/R.win/library`.

### 5.3. Installing `idepGolem` into the bundled library

The workflow builds and installs the app’s own R package into the bundled library:

```pwsh
- name: Build and install idepGolem into R.win/library
  shell: pwsh
  env:
    _R_CHECK_FORCE_SUGGESTS_: "false"
    R_BUILD_DONTFAIL_ON_WARNING_: "true"
    R_BUILD_TAR: tar
    TAR: tar
  run: |
    $app    = "${{ env.PACKAGE_DIR }}"
    $lib    = Join-Path $app "runtime\R.win\library"
    $Rexe   = Join-Path $app "runtime\R.winin\R.exe"
    $libR   = $lib -replace '\','/'
    Push-Location $env:PKG_SRC
    & $Rexe CMD build . --no-build-vignettes --no-manual
    $tar = (Get-ChildItem -Filter '*.tar.gz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    Pop-Location
    if (-not $tar) { throw "Package tarball not found after build" }
    $env:R_LIBS = $libR
    $env:R_LIBS_USER = $libR
    & $Rexe CMD INSTALL --library="$lib" $tar
```

---

## 6. Staging the Golem App for Electron

`main.js` expects the golem app under `APP_DIR/app`:

- `app/app.R`
- `app/R/` (server/ui code)
- `app/DESCRIPTION`

The CI workflow copies these from `PKG_SRC` into the Electron folder:

```pwsh
- name: Stage app sources into electron/app
  shell: pwsh
  run: |
    $app = "${{ env.PACKAGE_DIR }}"
    Push-Location $app
    if (Test-Path app) { Remove-Item -Recurse -Force app }
    New-Item -ItemType Directory -Force -Path app | Out-Null
    Pop-Location
    Copy-Item -Recurse -Force "$env:PKG_SRC\R"        "$apppp\R"
    Copy-Item -Force          "$env:PKG_SRCpp.R"    "$apppppp.R"
    Copy-Item -Force          "$env:PKG_SRC\DESCRIPTION" "$apppp\DESCRIPTION"
```

---

## 7. Electron Startup Flow (`main.js`)

### 7.1. High-level flow

On `app.whenReady()`:

1. **Splash window** (`showPlaceholder()`):
   - Renders a custom splash with a progress bar and status text.
   - Uses `setProgressBar()` to show progress in the Windows taskbar.
   - Exposes `window.updateSplash(pct, text)` in the renderer.

2. **Runtime detection**:
   - `getRuntime()` locates `runtime/R.win`.
   - Sets `R_HOME`, `R_LIBS`, `R_LIBS_USER`, `PATH`.

3. **Data directory**:
   - `DATA_PARENT` is chosen as:
     - `IDEP_DATA_DIR` or `IDEP_DATABASE` (if set), otherwise
     - Writable launch directory (`process.cwd()/idep`), otherwise
     - `<userData>/idep`
   - `electron_bootstrap.R` is written into this directory.

4. **Demo data directory hint**:
   - `DEMO_DIR` = `<APP_DIR>/data113`
   - Environment variable `IDEP_DEMO_DIR` is set to this path for R.

5. **Bootstrap script (`electron_bootstrap.R`)**:
   - Sets `.libPaths()` from `R_LIBS_USER`.
   - Patches `utils::download.file()` to:
     - Use a cached tarball (`data113_cache.tar.gz`) when available.
     - Cache the newly downloaded tarball for future runs.
   - Patches `utils::untar()` to skip untar if demo data directory already exists and is non-empty.
   - Logs detection of existing demo data.
   - Verifies presence of `ottoPlots` and `idepGolem`.
   - Runs:
     - `app <- idepGolem::run_app()`
     - `shiny::runApp(app, host = host, port = port, launch.browser = FALSE)`

6. **Spawning R**:
   - `main.js` spawns:

     ```js
     childProc = spawn(rscript, ['--vanilla', bootstrapPath], {
       cwd: DATA_PARENT,
       env: {
         ...process.env,
         ...env,
         IDEP_DATABASE: DATA_PARENT,
         IDEP_DATA_DIR: DATA_PARENT,
         IDEP_APP_DIR: APP_DIR,
         IDEP_HOST: host,
         IDEP_PORT: String(port),
         IDEP_DEMO_DIR: DEMO_DIR,
         R_LIBS_USER: env?.R_LIBS || path.join(path.dirname(rscript), '..', 'library'),
       },
       windowsHide: true,
     });
     ```

   - Progress bar is updated to ~0.5 (“Starting embedded R session…”).

7. **Port detection**:
   - Reads `idep_port.txt` from `DATA_PARENT`.
   - Parses `stderr` lines for `Listening on http://...:PORT`.
   - If both disagree, uses the port reported by Shiny.

8. **Waiting for Shiny**:
   - Calls `waitForHttp(finalURL)` until:
     - HTTP 2xx / 3xx / 404 / 403, or timeout.
   - On success, updates progress to ~0.9 (“Loading user interface…”).

9. **Loading the UI**:
   - Loads `finalURL` in the main `BrowserWindow`.
   - Clears taskbar progress with `setProgressBar(-1)`.

### 7.2. Demo data caching & skipping repeated work

The demo data tarball is at:

```r
demo_url <- "http://bioinformatics.sdstate.edu/data/data113/data113.tar.gz"
cache_tar <- file.path(data_dir, "data113_cache.tar.gz")
```

Behavior:

- If `download.file()` is called with `demo_url`:
  - If `cache_tar` exists → copy from cache instead of downloading.
  - Otherwise → download normally and copy into `cache_tar` after success.

- If `untar()` is called on a `tarfile` whose name contains `"data113"`:
  - If `exdir` exists and has files → skip untar.
  - Otherwise → perform normal untar.

Combined with `IDEP_DEMO_DIR = APP_DIR/data113` this prevents:

- Re-downloading the 19 MB demo file on each launch.
- Re-untarring it when already extracted.

---

## 8. GitHub Actions Workflow (Windows Build)

The main workflow file (e.g. `.github/workflows/build-windows.yml`) does the following:

1. **Checkout** the repository.
2. **Detect**:
   - `PACKAGE_DIR` (where `package.json` is: `electron/` or `.`)  
   - `PKG_SRC` (R package path where `DESCRIPTION` contains `Package: idepGolem`)
3. **Fix** any invalid R filenames (e.g. `_disable_autoload.R` → `z_disable_autoload.R`).
4. **Setup Node** (20.x) and install npm dependencies in `PACKAGE_DIR`.
5. **Ensure electron-builder** is available via dev dependency or `npx`.
6. **Setup R** (`r-lib/actions/setup-r@v2`) with Rtools 44.
7. **Stage R.win** runtime from system R → `PACKAGE_DIR/runtime/R.win`.
8. **Install ottoPlots** into `R.home()/library`.
9. **Install DESCRIPTION dependencies** into the bundled library.
10. **Build & install idepGolem** into that same library.
11. **Stage golem app** (`R/`, `app.R`, `DESCRIPTION`) into `PACKAGE_DIR/app`.
12. **Verify key packages** like `hgu133plus2.db` in the bundled lib.
13. **Build Electron app** (`npm run dist` or `npx electron-builder`).
14. **Upload artifacts** from `PACKAGE_DIR/dist/**` as a workflow artifact named `windows-dist`.

---

## 9. Building Locally (Manual)

To reproduce the CI build locally on Windows:

1. Install:
   - R 4.4.1 + Rtools 44
   - Node.js 20
   - Git

2. Clone the repository.

3. Identify:
   - `PACKAGE_DIR` → typically `electron/`
   - `PKG_SRC` → directory with `DESCRIPTION` containing `Package: idepGolem`

4. In PowerShell, roughly mirror the CI steps:
   - Mirror `R.home()` into `PACKAGE_DIR/runtime/R.win`
   - Install `ottoPlots` into `runtime/R.win/library`
   - Install DESCRIPTION dependencies into the bundled library
   - Build & install `idepGolem` into the same library
   - Copy `R/`, `app.R`, `DESCRIPTION` into `PACKAGE_DIR/app`

5. In `PACKAGE_DIR`:

   ```bash
   npm install
   npm run dist
   ```

6. Grab the installer / executable from `PACKAGE_DIR/dist/`.

---

## 10. Logs & Troubleshooting

### Log locations

- **Electron main log**  
  `%TEMP%/idep-electron.log`  
  Contents:
  - Runtime detection messages
  - Paths for `APP_DIR`, `DATA_PARENT`, `Rscript`, `bootstrap.R`
  - R stdout / stderr (`[R stdout]`, `[R stderr]`)
  - Port detection & waitForHttp messages

- **R-side log**  
  `<DATA_PARENT>/electron_r.log` where `DATA_PARENT` is typically:

  ```text
  %APPDATA%\<AppName>\idep
  ```

  Contains messages from bootstrap, package loading, `run_app()`, and Shiny.

### Common issues

1. **`Rscript.exe Not Found`**  
   - `runtime/R.win` is missing or incomplete.
   - Check the CI step that mirrors `R.home()` and check that the unpacked app includes `runtime/R.win/bin/Rscript.exe`.

2. **`Package 'ottoPlots' not found in vendored library`**  
   - ottoPlots installation failed (GitHub throttling / network).
   - Verify `GITHUB_PAT` / `GITHUB_TOKEN` and the `Install ottoPlots` step logs.

3. **Startup timeout: `App did not start at http://127.0.0.1:PORT within 120s`**
   - Check `electron_r.log` for a `FATAL:` line.
   - First run may be slower due to initial package loading; subsequent launches should improve due to caching.
   - Ensure no firewall / antivirus is blocking the local port.

---

## 11. Versioning & Release

- **Electron app version**: defined in `package.json` and/or electron-builder config.
- **R package version**: from `DESCRIPTION` (`Version: 2.20.2`, etc.).
- Keep both documented in release notes.
- Current workflow uploads build artifacts but does not automatically create GitHub Releases. This can be added later using:
  - electron-builder’s `--publish` flag, or
  - a separate release workflow that downloads artifacts and attaches them to a GitHub Release.

## 11. Runtime

![runtime1](docs/image.png)

![runtime2](docs/image-1.png)

![runtime3](docs/image-2.png)
---
