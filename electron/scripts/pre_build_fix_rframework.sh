#!/bin/bash
set -e

APP_NAME="idep-golem-electron"
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
R_FRAMEWORK_SRC="/Library/Frameworks/R.framework"
R_FRAMEWORK_DEST="$APP_ROOT/resources/R.framework"

echo "=== macOS Pre-Build: Preparing R.framework ==="
echo "App root: $APP_ROOT"

# Step 0: Clean duplicate R.framework copies
echo "Cleaning old resources..."
rm -rf "$APP_ROOT/resources/R.framework"

# Step 1: Copy R.framework
echo "Copying R.framework from $R_FRAMEWORK_SRC to $R_FRAMEWORK_DEST..."
mkdir -p "$APP_ROOT/resources"
cp -R "$R_FRAMEWORK_SRC" "$APP_ROOT/resources/"

cd "$R_FRAMEWORK_DEST"

# Step 2: Detect current version
CURRENT_VERSION=$(readlink Versions/Current || ls Versions | sort -V | tail -n 1)
echo "Detected Current R version: $CURRENT_VERSION"


# Step 3: Flatten "Current" into top-level
for ITEM in Headers Resources PrivateHeaders Libraries; do
  SRC_PATH="Versions/$CURRENT_VERSION/$ITEM"
  if [ -d "$SRC_PATH" ]; then
    echo "Copying $ITEM from $SRC_PATH"
    rm -rf "$ITEM"
    cp -R "$SRC_PATH" "$ITEM"
  else
    echo "$ITEM missing in $SRC_PATH — creating empty folder"
    rm -rf "$ITEM"
    mkdir "$ITEM"
  fi
done

# Step 4: Remove ALL Versions directories
echo "Removing Versions folders..."
find . -type d -name "Versions" -exec rm -rf {} +

cd "$APP_ROOT"

# Step 5: Verify Rscript exists
RSCRIPT_PATH="$R_FRAMEWORK_DEST/Resources/bin/Rscript"
echo "Checking Rscript..."
if [ ! -f "$RSCRIPT_PATH" ]; then
  echo "ERROR: Rscript not found at $RSCRIPT_PATH"
  exit 1
fi

echo "Success: R.framework prepared successfully. All Versions symlinks removed."
