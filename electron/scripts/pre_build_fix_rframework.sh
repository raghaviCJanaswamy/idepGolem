#!/bin/bash
set -euo pipefail

APP_NAME="idepGolem"
R_FRAMEWORK_SRC="/Library/Frameworks/R.framework"
R_FRAMEWORK_DEST="resources/R.framework"

echo "=== macOS Pre-Build: Preparing R.framework ==="

# Step 0: Clean duplicate R.framework copies (if any)
echo "Cleaning duplicate R.framework copies..."
rm -rf "$R_FRAMEWORK_DEST"

# Ensure destination folder exists
mkdir -p "$(dirname "$R_FRAMEWORK_DEST")"

# Step 1: Copy R.framework
echo "Copying R.framework from $R_FRAMEWORK_SRC ..."
cp -R "$R_FRAMEWORK_SRC" "$R_FRAMEWORK_DEST"

# Step 2: Flatten 'Current' so no 'Versions' symlinks remain
pushd "$R_FRAMEWORK_DEST" >/dev/null

CURRENT_VERSION=$(readlink Versions/Current || ls Versions | sort -V | tail -n 1 || true)
if [[ -z "${CURRENT_VERSION:-}" || ! -d "Versions/$CURRENT_VERSION" ]]; then
  echo "ERROR: Couldn't detect R.framework version inside $(pwd)"
  ls -l Versions || true
  exit 1
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

# Step 3: Remove ALL Versions directories recursively
echo "Removing ALL 'Versions' folders..."
find . -type d -name "Versions" -prune -exec rm -rf {} +

popd >/dev/null

# Step 4: Verify R and Rscript exist (handle either layout)
RSCRIPT_CANDIDATES=(
  "$R_FRAMEWORK_DEST/Resources/Rscript"
  "$R_FRAMEWORK_DEST/Resources/bin/Rscript"
)
R_CANDIDATES=(
  "$R_FRAMEWORK_DEST/Resources/R"
  "$R_FRAMEWORK_DEST/Resources/bin/R"
)

FOUND_RSCRIPT=""
for p in "${RSCRIPT_CANDIDATES[@]}"; do
  if [[ -f "$p" ]]; then
    FOUND_RSCRIPT="$p"
    break
  fi
done

FOUND_R=""
for p in "${R_CANDIDATES[@]}"; do
  if [[ -f "$p" ]]; then
    FOUND_R="$p"
    break
  fi
done

if [[ -z "$FOUND_RSCRIPT" ]]; then
  echo "ERROR: Rscript not found in expected locations:"
  printf '  - %s\n' "${RSCRIPT_CANDIDATES[@]}"
  echo "Directory listing of Resources:"
  ls -la "$R_FRAMEWORK_DEST/Resources" || true
  exit 1
fi

if [[ -z "$FOUND_R" ]]; then
  echo "WARNING: 'R' launcher not found; continuing, but some tooling expects it."
  printf '  Checked: %s\n' "${R_CANDIDATES[@]}"
fi

# Ensure executability
chmod +x "$FOUND_RSCRIPT" || true
[[ -n "$FOUND_R" ]] && chmod +x "$FOUND_R" || true

echo "Success: R.framework prepared."
echo "Using Rscript at: $FOUND_RSCRIPT"
[[ -n "$FOUND_R" ]] && echo "Using R at: $FOUND_R"
