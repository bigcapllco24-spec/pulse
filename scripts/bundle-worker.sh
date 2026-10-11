#!/usr/bin/env bash
# Builds worker/dist/pulse-ai.js: the AI relay as one file (for pasting into the Cloudflare dashboard editor).
set -e
cd "$(dirname "$0")/.."
mkdir -p worker/dist
{ echo "// Built by scripts/bundle-worker.sh from worker/worker.js and pipeline/lib/google.mjs. Don't edit by hand."
  sed -E 's/^export (async function|function|const)/\1/' pipeline/lib/google.mjs
  grep -v '^import { serviceAccount, firestore } from' worker/worker.js
} > worker/dist/pulse-ai.js
node --check worker/dist/pulse-ai.js && echo "worker/dist/pulse-ai.js ($(wc -c < worker/dist/pulse-ai.js) bytes)"
