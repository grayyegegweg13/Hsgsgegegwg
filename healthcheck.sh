#!/usr/bin/env bash
# Usage: ./healthcheck.sh [base_url]   (default http://127.0.0.1:$PORT)
set -euo pipefail
cd "$(dirname "$0")"
PORT_VAL="$( (grep -E '^PORT=' .env 2>/dev/null || echo PORT=3000) | tail -1 | cut -d= -f2)"
URL="${1:-http://127.0.0.1:${PUBLISH_PORT:-$PORT_VAL}}"
if body="$(curl -fsS --max-time 5 "$URL/health")"; then
  echo "OK  $URL/health -> $body"
else
  echo "FAIL  $URL/health is not responding" >&2
  exit 1
fi
