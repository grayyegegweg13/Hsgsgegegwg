#!/usr/bin/env bash
# One-time "Login with Google" for Gemini CLI that is SAVED and reused by the web app.
#   ./login.sh            Docker deployment
#   ./login.sh --native   Native (systemd) deployment
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# Writes security.auth.selectedType=oauth-personal (and legacy selectedAuthType) into settings.json
SET_AUTH='const f=process.argv[1],fs=require("fs");let s={};try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
s.security=s.security||{};s.security.auth=s.security.auth||{};s.security.auth.selectedType="oauth-personal";
s.selectedAuthType="oauth-personal";fs.writeFileSync(f,JSON.stringify(s,null,2));console.log("auth type saved in",f)'

if [[ "${1:-}" == "--native" ]]; then
  mkdir -p "$HOME/.gemini" && chmod 700 "$HOME/.gemini"
  node -e "$SET_AUTH" "$HOME/.gemini/settings.json"
  say "Pick 'Login with Google', open the URL, paste the code, then type /quit"
  NO_BROWSER=true GEMINI_FORCE_FILE_STORAGE=true gemini
  ls -l "$HOME/.gemini/oauth_creds.json" && say "Saved. Restarting app" && sudo systemctl restart gemini-prompt
  exit 0
fi

mkdir -p gemini-auth
sudo chown -R 1000:1000 gemini-auth && sudo chmod 700 gemini-auth
docker compose up -d
docker compose exec app node -e "$SET_AUTH" /home/node/.gemini/settings.json
say "Pick 'Login with Google' if asked, open the URL, paste the code, then type /quit"
docker compose exec -it -e NO_BROWSER=true app gemini
if sudo test -s gemini-auth/oauth_creds.json; then
  say "Login saved in ./gemini-auth/oauth_creds.json. Restarting app"
  docker compose restart app
  docker compose exec app gemini -p "Say hello" --output-format json | head -c 300; echo
else
  echo "Login was NOT saved (oauth_creds.json missing). Run ./login.sh again." >&2; exit 1
fi
