#!/usr/bin/env bash
set -euo pipefail

# Root of your Electron project (defaults to current dir; CI sets PROJECT_DIR=electron)
ROOT="${PROJECT_DIR:-.}"
RFW="$ROOT/resources/R.framework"

echo "=== verify_r_runtime ==="
echo "ROOT=$ROOT"
echo "RFW=$RFW"

# Show layout for debugging
ls -la "$RFW" || true
ls -la "$RFW/Resources" || true
[ -d "$RFW/Resources" ] || { echo "❌ Missing $RFW/Resources"; exit 1; }

# Find Rscript in the flattened framework
CANDIDATES=(
  "$RFW/Resources/bin/Rscript"
  "$RFW/Resources/Rscript"
)

FOUND=""
for p in "${CANDIDATES[@]}"; do
  if [ -f "$p" ]; then
    FOUND="$p"
    break
  fi
done

if [ -z "$FOUND" ]; then
  echo "❌ Rscript not found in $RFW/Resources{,/bin}"
  exit 1
fi

# Ensure it's executable
if [ ! -x "$FOUND" ]; then
  echo "ℹ️ $FOUND not executable — fixing perms"
  chmod +x "$FOUND" || true
fi
echo "✅ Rscript: $FOUND"

# Optionally require your app entry R file
REQUIRE_RUN_APP="${REQUIRE_RUN_APP:-0}"  # set to 1 to make it mandatory
if [ -f "$ROOT/app/run_app.R" ]; then
  echo "✅ Found $ROOT/app/run_app.R"
else
  if [ "$REQUIRE_RUN_APP" = "1" ]; then
    echo "❌ $ROOT/app/run_app.R missing"
    exit 1
  else
    echo "⚠️ $ROOT/app/run_app.R not found — continuing (REQUIRE_RUN_APP=0)"
  fi
fi

echo "Sources OK"
