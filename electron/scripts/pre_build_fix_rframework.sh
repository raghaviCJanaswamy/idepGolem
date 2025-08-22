#!/bin/bash
set -e

APP_NAME="my-golem-electron"
R_FRAMEWORK_SRC="/Library/Frameworks/R.framework"
R_FRAMEWORK_DEST="electron/resources/R.framework"

echo "=== macOS Pre-Build: Preparing R.framework ==="

# Step 0: Clean duplicate R.framework copies
echo "Cleaning duplicate R.framework copies..."
rm -rf resources/R.framework
rm -rf electron/electron/resources/R.framework

# Step 1: Clean previous copy in electron/resources
rm -rf "$R_FRAMEWORK_DEST"
mkdir -p electron/resources

# Step 2: Copy R.framework
echo "Copying R.framework..."
cp -R "$R_FRAMEWORK_SRC" electron/resources/

cd "$R_FRAMEWORK_DEST"

# Step 3: Detect current version
CURRENT_VERSION=$(readlink Versions/Current || ls Versions | sort -V | tail -n 1)
echo "Detected Current R version: $CURRENT_VERSION"

# Step 4: Flatten Current
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

# Step 5: Remove ALL Versions directories recursively
echo "Removing ALL Versions folders..."
find . -type d -name "Versions" -exec rm -rf {} +

cd ../../..

# Step 6: Verify Rscript exists
RSCRIPT_PATH="$R_FRAMEWORK_DEST/Resources/bin/Rscript"
echo "Checking Rscript..."
if [ ! -f "$RSCRIPT_PATH" ]; then
  echo "ERROR: Rscript not found at $RSCRIPT_PATH"
  exit 1
fi

echo "Success: R.framework prepared successfully. All Versions symlinks removed."
