#!/usr/bin/env bash
# One-time "Login with Google" for Gemini CLI that is SAVED and reused by the web app.
#   ./login.sh            Docker deployment
#   ./login.sh --native   Native (systemd) deployment
#
# NOTE: "gemini auth login" is NOT a Gemini CLI command. It just opens the normal
# interactive CLI, which is why it kept asking again. Use this script instead.
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Writes security.auth.selectedType=oauth-personal (and legacy selectedAuthType) into settings.json
SET_AUTH='const f=process.argv[1],fs=require("fs");let s={};try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
s.security=s.security||{};s.security.auth=s.security.auth||{};s.security.auth.selectedType="oauth-personal";
s.selectedAuthType="oauth-personal";fs.writeFileSync(f,JSON.stringify(s,null,2));console.log("auth type saved in",f)'

# Newer Gemini CLI saves the login in gemini-credentials.json (encrypted),
# older versions in oauth_creds.json. Either one means the login was saved.
has_login() { # $1 = directory, $2 = "sudo" or ""
  $2 test -s "$1/gemini-credentials.json" || $2 test -s "$1/oauth_creds.json"
}

if [[ "${1:-}" == "--native" ]]; then
  mkdir -p "$HOME/.gemini" && chmod 700 "$HOME/.gemini"
  node -e "$SET_AUTH" "$HOME/.gemini/settings.json"
  say "Pick 'Login with Google', open the URL, paste the code ONCE, then type /quit"
  NO_BROWSER=true GEMINI_FORCE_FILE_STORAGE=true GOOGLE_GENAI_USE_GCA=true gemini
  has_login "$HOME/.gemini" "" || die "Login was NOT saved. Run ./login.sh --native again."
  say "Login saved. Testing it"
  GEMINI_FORCE_FILE_STORAGE=true GOOGLE_GENAI_USE_GCA=true gemini -p "Say hello" --output-format json | head -c 300; echo
  sudo systemctl restart gemini-prompt
  exit 0
fi

mkdir -p gemini-auth
sudo chown -R 1000:1000 gemini-auth && sudo chmod 700 gemini-auth

# Recreate the container so it gets the fixed hostname (needed to read the saved login later).
say "Starting the app container"
docker compose up -d --force-recreate app
[[ "$(docker compose exec -T app hostname)" == "gemini-prompt" ]] \
  || die "Container hostname is not 'gemini-prompt'. Use the docker-compose.yml from this zip."

docker compose exec -T app node -e "$SET_AUTH" /home/node/.gemini/settings.json

if has_login gemini-auth sudo && docker compose exec -T app gemini -p "Say OK" --output-format json >/dev/null 2>&1; then
  say "You are already logged in. Nothing to do."
else
  say "Pick 'Login with Google' if asked, open the URL in your browser,"
  say "paste the code ONCE, wait for the prompt box, then type /quit"
  docker compose exec -it -e NO_BROWSER=true app gemini
  has_login gemini-auth sudo || die "Login was NOT saved (no credentials file in ./gemini-auth). Run ./login.sh again."
fi

# Prove the login survives a full container recreate (same as after a rebuild/reboot).
say "Login saved. Recreating the container to prove it stays logged in"
docker compose up -d --force-recreate app
sleep 3
if docker compose exec -T app gemini -p "Say hello" --output-format json | head -c 300; then
  echo; say "Done. The web app now uses your Google login."
else
  die "Saved login could not be used. Send the output of: docker compose logs app --tail 50"
fi
