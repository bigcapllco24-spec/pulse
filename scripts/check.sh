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
  bad=0; tmpd=$(mktemp -d); for f in web/js/*.js web/*.js pipeline/*.mjs pipeline/lib/*.mjs; do cp "$f" "$tmpd/x.mjs"; node --check "$tmpd/x.mjs" 2>/dev/null || { echo "FAIL syntax: $f"; bad=1; }; done
  # a key handler written as  el.onkeydown = (e) => cond && go()  returns false for every other key, which drops the
  # keystroke on phones (1.2.1 username box). Key handlers must use braces.
  if grep -nE '\.on(keydown|keypress|keyup)\s*=\s*\([^)]*\)\s*=>\s*[^{ ]' web/js/*.js; then echo "FAIL syntax: key handler without braces (above)"; bad=1; fi
  [[ $bad == 0 ]] && echo "syntax: all files parse" || status=1
fi
[[ $only == all || $only == lint ]] && run node tests/lint.mjs
[[ $only == all || $only == pipeline ]] && run node tests/pipeline.test.mjs
[[ $only == all || $only == levels ]] && run node tests/levels.test.mjs
[[ $only == all || $only == score ]] && run node tests/score.test.mjs $verbose
[[ $only == all || $only == score2 ]] && run node tests/score2.test.mjs $verbose
[[ $only == all || $only == predict ]] && run node tests/predict.test.mjs $verbose
[[ $only == all || $only == social ]] && run node tests/social.test.mjs $verbose
[[ $only == all || $only == habit ]] && run node tests/habit.test.mjs $verbose
[[ $only == all || $only == stamp ]] && run node tests/stamp.test.mjs
if [[ $only == all || $only == e2e ]]; then
  port=$((8800 + RANDOM % 100))
  (cd web && exec python3 -m http.server "$port" >/dev/null 2>&1) & srv=$!
  sleep 1
  run python3 tests/e2e.py "http://localhost:$port/" $verbose
  kill "$srv" 2>/dev/null
fi
# the offline copy and releases (serves its own copy of web/)
[[ $only == all || $only == sw ]] && run python3 tests/sw.py $verbose
[[ $status == 0 ]] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $status
