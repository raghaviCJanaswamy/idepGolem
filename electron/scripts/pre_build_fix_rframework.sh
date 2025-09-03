# .github/workflows/build-mac.yml
name: build-mac

on:
  workflow_dispatch:
  push:
    branches: ["gitac"]
  pull_request:
    paths:
      - "**/scripts/**"
      - "**/app/**"
      - "**/resources/**"
      - "**/main.js"
      - "**/package.json"

jobs:
  mac:
    name: mac (${{ matrix.arch }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: macos-14
            arch: arm64
          - runner: macos-13
            arch: x64
    runs-on: ${{ matrix.runner }}

    env:
      PROJECT_DIR: .
      R_VERSION: "4.4.1"
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      APPLE_ID: ${{ secrets.APPLE_ID }}
      APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      CSC_LINK: ${{ secrets.MAC_CERT_P12_BASE64 }}
      CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
      CSC_IDENTITY_AUTO_DISCOVERY: ${{ (secrets.APPLE_ID && secrets.MAC_CERT_P12_BASE64) && 'true' || 'false' }}

    steps:
      - uses: actions/checkout@v4

      # Auto-detect project dir if yours is in a subfolder
      - name: Detect project directory
        if: env.PROJECT_DIR == '.'
        shell: bash
        run: |
          set -euo pipefail
          for d in "." "idep-golem-package" "electron" "app"; do
            if [ -f "$d/package.json" ]; then echo "PROJECT_DIR=$d" >> "$GITHUB_ENV"; exit 0; fi
          done
          found="$(git ls-files | grep -E '/?package\.json$' | grep -v node_modules | head -n1 || true)"
          [ -n "$found" ] && echo "PROJECT_DIR=$(dirname "$found")" >> "$GITHUB_ENV" || (echo "No package.json found" && exit 1)

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      # 1) Install R via CRAN package (this puts R.framework in /Library/Frameworks)
      - name: Setup R ${{ env.R_VERSION }}
        uses: r-lib/actions/setup-r@v2
        with:
          r-version: ${{ env.R_VERSION }}

      # 2) Sanity check that the Framework is present (debug if not)
      - name: Confirm R.framework is present
        shell: bash
        run: |
          set -euxo pipefail
          R --version
          R RHOME || true
          ls -l /Library/Frameworks || true
          test -d /Library/Frameworks/R.framework

      - name: Install deps
        working-directory: ${{ env.PROJECT_DIR }}
        run: |
          npm config set fund false
          npm install --no-audit --no-fund

      # 3) Run your mac-only R.framework flattening script
      - name: Prepare embedded R.framework (flatten)
        working-directory: ${{ env.PROJECT_DIR }}
        shell: bash
        run: |
          set -euo pipefail
          chmod +x scripts/pre_build_fix_rframework.sh || true
          bash scripts/pre_build_fix_rframework.sh

      - name: Verify flattened R.framework
        working-directory: ${{ env.PROJECT_DIR }}
        shell: bash
        run: |
          set -euo pipefail
          RFW="resources/R.framework"
          [ -d "$RFW/Resources" ]
          if [ -x "$RFW/Resources/bin/Rscript" ] || [ -x "$RFW/Resources/Rscript" ]; then
            echo "✅ Rscript exists in flattened framework"
          else
            echo "❌ Rscript missing in $RFW/Resources"; ls -la "$RFW/Resources" || true; exit 1
          fi

      - name: Build (macOS ${{ matrix.arch }})
        working-directory: ${{ env.PROJECT_DIR }}
        run: |
          set -euo pipefail
          if npm run -s dist:mac --if-present; then
            echo "Ran npm run dist:mac"
          elif npm run -s dist:mac-build --if-present; then
            echo "Ran npm run dist:mac-build"
          else
            npx electron-builder --mac --${{ matrix.arch }}
          fi

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: mac-${{ matrix.arch }}-dist
          path: |
            ${{ env.PROJECT_DIR }}/dist/**/*.dmg
            ${{ env.PROJECT_DIR }}/dist/**/*.zip
            ${{ env.PROJECT_DIR }}/dist/**/*.app
            ${{ env.PROJECT_DIR }}/dist/*.yml
            ${{ env.PROJECT_DIR }}/dist/*.blockmap
          if-no-files-found: warn
