#!/usr/bin/env bash
# Safe deployment helper for Ubuntu 22.04 / 24.04.
#   ./deploy.sh            Docker deployment (default)
#   ./deploy.sh --native   Native Node.js + systemd deployment
set -euo pipefail
cd "$(dirname "$0")"

MODE="docker"
[[ "${1:-}" == "--native" ]] && MODE="native"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] && die "Run as your normal user (with sudo rights), not as root."

# 1. Environment file
if [[ ! -f .env ]]; then
  say "Creating .env from .env.example"
  cp .env.example .env
  chmod 600 .env
fi
chmod 600 .env
set -a; source .env; set +a
[[ "${GEMINI_PROVIDER:-cli}" == "api" && -z "${GEMINI_API_KEY:-}" ]] && die "GEMINI_PROVIDER=api requires GEMINI_API_KEY in .env"

if [[ "$MODE" == "docker" ]]; then
  command -v docker >/dev/null || die "Docker is not installed. See README > 'Install Docker'."
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin missing (sudo apt install docker-compose-plugin)."

  # 2. Credential directory on the host (never inside the image)
  mkdir -p gemini-auth && chmod 700 gemini-auth
  if [[ "${GEMINI_PROVIDER:-cli}" == "cli" ]]; then
    if [[ ! -f gemini-auth/oauth_creds.json && ! -f gemini-auth/settings.json ]]; then
      if [[ -d "$HOME/.gemini" ]]; then
        say "Copying your existing Gemini CLI login from ~/.gemini into ./gemini-auth"
        cp -a "$HOME/.gemini/." gemini-auth/
      else
        say "No Gemini CLI login found yet. After start-up run:"
        echo "     docker compose exec -it app gemini      # complete the Google sign-in once"
      fi
    fi
    # Container runs as uid 1000
    if [[ "$(id -u)" != "1000" ]]; then
      say "Setting ./gemini-auth owner to uid 1000 (container user)"
      sudo chown -R 1000:1000 gemini-auth
    fi
  fi

  say "Building and starting containers"
  docker compose up -d --build
else
  command -v node >/dev/null || die "Node.js 20+ is required. See README > 'Native install'."
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  (( NODE_MAJOR >= 20 )) || die "Node.js 20+ required (found $(node -v))."
  if [[ "${GEMINI_PROVIDER:-cli}" == "cli" ]]; then
    command -v "${GEMINI_COMMAND:-gemini}" >/dev/null || die "Gemini CLI not found. Run: sudo npm install -g @google/gemini-cli"
  fi
  say "Installing and building"
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
  (cd backend && npm ci --omit=dev --no-audit --no-fund)
  say "Installing systemd service"
  sudo cp deploy/gemini-prompt.service /etc/systemd/system/gemini-prompt.service
  sudo sed -i "s#__USER__#$(id -un)#g; s#__DIR__#$PWD#g" /etc/systemd/system/gemini-prompt.service
  NODE_DIR="$(dirname "$(command -v node)")"
  GEM_DIR="$(dirname "$(command -v "${GEMINI_COMMAND:-gemini}" 2>/dev/null || echo /usr/local/bin/x)")"
  sudo sed -i "s#^Environment=PATH=.*#Environment=PATH=${NODE_DIR}:${GEM_DIR}:/usr/local/bin:/usr/bin:/bin#" /etc/systemd/system/gemini-prompt.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now gemini-prompt
  sudo systemctl restart gemini-prompt
fi

say "Waiting for health check"
for _ in $(seq 1 30); do
  if ./healthcheck.sh >/dev/null 2>&1; then ./healthcheck.sh; IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; say "Deployed. Open http://${IP:-SERVER_IP}:${PUBLISH_PORT:-${PORT:-3000}}  (firewall: sudo ufw allow ${PUBLISH_PORT:-${PORT:-3000}}/tcp)"; exit 0; fi
  sleep 2
done
die "App did not become healthy. Check logs: docker compose logs app  |  journalctl -u gemini-prompt -n 100"
