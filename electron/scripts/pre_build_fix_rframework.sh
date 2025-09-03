#!/usr/bin/env bash
set -euo pipefail

APP_NAME="idepGolem"

# Canonical CRAN framework location
R_FRAMEWORK_SRC="/Library/Frameworks/R.framework"

# Fallback: derive from R RHOME if installed as a framework
if [[ ! -d "$R_FRAMEWORK_SRC" ]]; then
  if command -v R >/dev/null 2>&1; then
    RH=$(R RHOME 2>/dev/null || true)
    if [[ -n "${RH:-}" && "$RH" == *"/R.framework/Resources" ]]; then
      R_FRAMEWORK_SRC="$(dirname "$RH")"
    fi
  fi
fi

if [[ ! -d "$R_FRAMEWORK_SRC" ]]; then
  echo "ERROR: R.framework not found."
  echo "  Looked for /Library/Frameworks/R.framework and (dirname of R RHOME)."
  echo "  Ensure the workflow runs 'r-lib/actions/setup-r@v2' before this script."
  command -v R >/dev/null 2>&1 && (R --version; echo "RHOME=$(R RHOME || true)") || echo "R command not found"
  ls -l /Library/Frameworks || true
  exit 1
fi

R_FRAMEWORK_DEST="resources/R.framework"

echo "=== macOS Pre-Build: Preparing R.framework ==="
echo "Using source: $R_FRAMEWORK_SRC"
echo "Dest: $R_FRAMEWORK_DEST"

# Clean previous copy
rm -rf "$R_FRAMEWORK_DEST"
mkdir -p "$(dirname "$R_FRAMEWORK_DEST")"

# Copy preserving symlinks/attrs
rsync -a "$R_FRAMEWORK_SRC/" "$R_FRAMEWORK_DEST/"

# Flatten 'Current' so no Versions/* remain
pushd "$R_FRAMEWORK_DEST" >/dev/null
CURRENT_VERSION=$(readlink Versions/Current || ls Versions | sort -V | tail -n 1 || true)
if [[ -z "${CURRENT_VERSION:-}" || ! -d "Versions/$CURRENT_VERSION" ]]; then
  echo "ERROR: Couldn't detect R.framework version in $(pwd)"; ls -l Versions || true; exit 1
fi
echo "Detected Current R version: $CURRENT_VERSION"

for ITEM in Headers Resources PrivateHeaders Libraries; do
  SRC_PATH="Versions/$CURRENT_VERSION/$ITEM"
  if [[ -d "$SRC_PATH" ]]; then
    echo "Copying $ITEM from $SRC_PATH"
    rm -rf "$ITEM"
    cp -R "$SRC_PATH" "$ITEM"
  else
    echo "$ITEM missing in $SRC_PATH — creating empty folder"
    rm -rf "$ITEM"
    mkdir -p "$ITEM"
  fi
done

echo "Removing ALL 'Versions' folders..."
find . -type d -name "Versions" -prune -exec rm -rf {} +

popd >/dev/null

# Verify Rscript (and R) exist in flattened layout
RSCRIPT_CANDIDATES=(
  "$R_FRAMEWORK_DEST/Resources/Rscript"
  "$R_FRAMEWORK_DEST/Resources/bin/Rscript"
)
R_CANDIDATES=(
  "$R_FRAMEWORK_DEST/Resources/R"
  "$R_FRAMEWORK_DEST/Resources/bin/R"
)

FOUND_RSCRIPT=""
for p in "${RSCRIPT_CANDIDATES[@]}"; do [[ -f "$p" ]] && { FOUND_RSCRIPT="$p"; break; }; done
FOUND_R=""
for p in "${R_CANDIDATES[@]}";    do [[ -f "$p" ]] && { FOUND_R="$p"; break; }; done

if [[ -z "$FOUND_RSCRIPT" ]]; then
  echo "ERROR: Rscript not found in Resources/ or Resources/bin/"; ls -la "$R_FRAMEWORK_DEST/Resources" || true; exit 1
fi
chmod +x "$FOUND_RSCRIPT" || true
[[ -n "$FOUND_R" ]] && chmod +x "$FOUND_R" || true

echo "Success: R.framework prepared."
echo "Using Rscript at: $FOUND_RSCRIPT"
[[ -n "$FOUND_R" ]] && echo "Using R at: $FOUND_R"
