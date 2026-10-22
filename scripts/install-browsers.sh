#!/usr/bin/env bash
# Installs Playwright and the browsers the tests use (CI only): scripts/install-browsers.sh chromium [webkit].
# GitHub's runner sometimes stalls here, so the two phases (system packages, browser download) each get 4 minutes and
# 3 tries, with a stalled try's lock cleared before the next. The warnings name the phase that stalled.
set -u
pip install -q playwright==1.56.0 || exit 1

try() {
  local what=$1; shift
  for i in 1 2 3; do
    if timeout -k 10 240 "$@"; then return 0; fi
    echo "::warning::browsers: $what, try $i failed or stalled"
    rm -rf "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}/__dirlock"
  done
  echo "::error::browsers: $what failed 3 times"; return 1
}
try "system packages" python -m playwright install-deps "$@" || exit 1
try "browser download" python -m playwright install "$@" || exit 1
