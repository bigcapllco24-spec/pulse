#!/usr/bin/env bash
# One command for every check. Prints only failures and one summary line per suite.
# Usage: scripts/check.sh            (all suites)
#        scripts/check.sh e2e -v     (one suite, every check listed)
set -u
cd "$(dirname "$0")/.."
only="${1:-all}"; verbose="${2:-}"
status=0
run() { "$@" || status=1; }

if [[ $only == all || $only == syntax ]]; then
  bad=0; for f in web/js/*.js web/*.js pipeline/*.mjs pipeline/lib/*.mjs worker/*.js; do node --check "$f" 2>/dev/null || { echo "FAIL syntax: $f"; bad=1; }; done
  [[ $bad == 0 ]] && echo "syntax: all files parse" || status=1
fi
[[ $only == all || $only == pipeline ]] && run node tests/pipeline.test.mjs
[[ $only == all || $only == worker ]] && run node tests/worker.test.mjs
[[ $only == all || $only == levels ]] && run node tests/levels.test.mjs
if [[ $only == all || $only == e2e ]]; then
  port=$((8800 + RANDOM % 100))
  (cd web && exec python3 -m http.server "$port" >/dev/null 2>&1) & srv=$!
  sleep 1
  run python3 tests/e2e.py "http://localhost:$port/" $verbose
  kill "$srv" 2>/dev/null
fi
[[ $status == 0 ]] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $status
