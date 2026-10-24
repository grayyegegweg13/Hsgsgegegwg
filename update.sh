#!/usr/bin/env bash
# Update helper. Pull new code first (git pull, or extract a new ZIP over this folder
# keeping .env and gemini-auth/), then run:
#   ./update.sh            Docker
#   ./update.sh --native   Native systemd install
#   ./update.sh --cli      Also upgrade Gemini CLI to the latest version
set -euo pipefail
cd "$(dirname "$0")"
NATIVE=0; CLI=0
for a in "$@"; do [[ $a == --native ]] && NATIVE=1; [[ $a == --cli ]] && CLI=1; done

[[ -f .env ]] || { echo ".env missing - run ./deploy.sh first"; exit 1; }
[[ -d .git ]] && git pull --ff-only || true

if (( NATIVE )); then
  (( CLI )) && sudo npm install -g @google/gemini-cli@latest
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
  (cd backend && npm ci --omit=dev --no-audit --no-fund)
  sudo systemctl restart gemini-prompt
else
  if (( CLI )); then docker compose build --no-cache --pull app; else docker compose build --pull app; fi
  docker compose up -d
  docker image prune -f >/dev/null
fi
sleep 3
./healthcheck.sh
