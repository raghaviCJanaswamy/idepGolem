#!/usr/bin/env bash
set -euo pipefail
test -x resources/R.framework/Resources/bin/Rscript || test -x resources/R.framework/Resources/Rscript || { echo "R.framework missing"; exit 1; }
test -f app/run_app.R || { echo "app/run_app.R missing"; exit 1; }
echo "Sources OK"
