#!/bin/bash
set -e

APP_PATH=$(find dist -name "*.app" | head -n 1)
RSCRIPT_PATH="$APP_PATH/Contents/Resources/R.framework/Resources/bin/Rscript"

echo "🔍 Post-Build Check: Verifying Rscript in .app"

if [ -f "$RSCRIPT_PATH" ]; then
  echo "Success: Found Rscript: $RSCRIPT_PATH"
  "$RSCRIPT_PATH" --version || { echo "ERROR: Rscript did not execute correctly"; exit 1; }
else
  echo "ERROR: Rscript not found in $APP_PATH"
  exit 1
fi
