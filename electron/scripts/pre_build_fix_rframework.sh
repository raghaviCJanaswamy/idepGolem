#!/usr/bin/env bash
set -euo pipefail

# Skip on non-macOS
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Non-macOS host; skipping R.framework preparation."
  exit 0
fi

DEST_ROOT="resources/R.framework"
echo "=== Prepare R runtime into $DEST_ROOT ==="

copy_dir(){ rsync -a "$1/" "$2/"; }

FRAME_SRC="/Library/Frameworks/R.framework"
RHOME="$(command -v R >/dev/null 2>&1 && R RHOME || echo "")"

MODE="unknown"
if [[ -d "$FRAME_SRC" ]]; then
  MODE="framework-cran"
elif [[ -n "$RHOME" && "$RHOME" == *"/R.framework/Resources" && -d "$RHOME" ]]; then
  MODE="framework-alt"; FRAME_SRC="$(dirname "$RHOME")"
elif [[ -n "$RHOME" && -d "$RHOME" ]]; then
  MODE="brew-libR"; RES_SRC="$RHOME"
fi

echo "Detected mode: $MODE"
[[ "$MODE" != "unknown" ]] || { echo "❌ No usable R install found"; exit 1; }

rm -rf "$DEST_ROOT"; mkdir -p "$DEST_ROOT"

if [[ "$MODE" == "framework-cran" || "$MODE" == "framework-alt" ]]; then
  echo "Copying framework from $FRAME_SRC"
  copy_dir "$FRAME_SRC" "$DEST_ROOT"
  pushd "$DEST_ROOT" >/dev/null
  CUR=$(readlink Versions/Current || ls Versions | sort -V | tail -n 1 || true)
  [[ -n "$CUR" && -d "Versions/$CUR" ]] || { echo "❌ No version in framework"; ls -l Versions || true; exit 1; }
  for ITEM in Headers Resources PrivateHeaders Libraries; do
    SRC="Versions/$CUR/$ITEM"
    [[ -d "$SRC" ]] && { rm -rf "$ITEM"; cp -R "$SRC" "$ITEM"; } || { rm -rf "$ITEM"; mkdir -p "$ITEM"; }
  done
  find . -type d -name "Versions" -prune -exec rm -rf {} +
  popd >/dev/null
else
  echo "Synthesizing framework-like layout from RHOME=$RES_SRC"
  mkdir -p "$DEST_ROOT/Resources" "$DEST_ROOT/Libraries" "$DEST_ROOT/Headers" "$DEST_ROOT/PrivateHeaders"
  copy_dir "$RES_SRC" "$DEST_ROOT/Resources"
fi

# Verify
RS=("$DEST_ROOT/Resources/bin/Rscript" "$DEST_ROOT/Resources/Rscript")
found=""
for p in "${RS[@]}"; do [[ -f "$p" ]] && { found="$p"; break; }; done
[[ -n "$found" ]] || { echo "❌ Rscript missing"; ls -la "$DEST_ROOT/Resources" || true; exit 1; }
chmod +x "$found" || true
echo "✅ Rscript at $found"
