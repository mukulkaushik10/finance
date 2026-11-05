#!/usr/bin/env bash
# One command to run Control Room in GitHub Codespaces (or any Linux machine):
#   bash scripts/codespace-start.sh
# Starts Postgres if needed (Docker if available, otherwise the system package),
# installs, loads demo data on first run, prints the link, runs the app.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf "\n\033[1;34m==> %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m%s\033[0m\n\n" "$1"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
pg_up() { node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; }
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
as_pg() { if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi; }

if ! have node; then
  fail "Node.js is not available in this container. If this is a GitHub codespace, it is probably in recovery mode:
press Ctrl+Shift+P (Cmd+Shift+P on Mac), run \"Codespaces: Rebuild Container\", and wait for it to finish."
fi

say "Control Room: getting ready (first time takes about 3 minutes)"
[ -f .env ] || cp .env.example .env

start_with_docker() {
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  docker info >/dev/null 2>&1 || return 1
  if docker ps -a --format '{{.Names}}' | grep -qx controlroom-db; then
    docker start controlroom-db >/dev/null
  else
    docker run --name controlroom-db -e POSTGRES_USER=controlroom -e POSTGRES_PASSWORD=controlroom \
      -e POSTGRES_DB=controlroom -p 5432:5432 -d --restart unless-stopped postgres:16 >/dev/null
  fi
  for i in $(seq 1 60); do docker exec controlroom-db pg_isready -U controlroom -d controlroom >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

start_with_system_postgres() {
  have apt-get || return 1
  if ! have pg_ctlcluster && ! ls /usr/lib/postgresql/*/bin/postgres >/dev/null 2>&1; then
    say "Installing Postgres (about 1 minute)"
    $SUDO apt-get update -qq
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq postgresql >/dev/null
  fi
  $SUDO service postgresql start >/dev/null 2>&1 || $SUDO pg_ctlcluster "$(ls /usr/lib/postgresql | sort -n | tail -1)" main start
  for i in $(seq 1 30); do pg_up && break; sleep 1; done
  as_pg psql -qtc "SELECT 1 FROM pg_roles WHERE rolname='controlroom'" | grep -q 1 \
    || as_pg psql -qc "CREATE ROLE controlroom WITH LOGIN SUPERUSER PASSWORD 'controlroom'"
  as_pg psql -qtc "SELECT 1 FROM pg_database WHERE datname='controlroom'" | grep -q 1 \
    || as_pg createdb -O controlroom controlroom
}

if ! pg_up; then
  say "Starting the database"
  if have docker && start_with_docker; then :
  elif start_with_system_postgres; then :
  else fail "Could not start a Postgres database: Docker isn't available and Postgres couldn't be installed.
Install Postgres 16 and make it reachable at localhost:5432 with user/password controlroom, then run this again."
  fi
  pg_up || fail "The database did not come up on localhost:5432."
fi

if [ ! -d node_modules/@prisma/client ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing (about 1-2 minutes)"
  npm ci --no-audit --no-fund
fi
npx prisma generate >/dev/null

# Load demo data if the database has none, or if it predates the supplier portal.
# (Checks the database itself, not a marker file.)
demo_state() {
  node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
Promise.all([p.user.count(), p.vendorUser.count()])
  .then(([u, v]) => { console.log(u === 0 ? 'empty' : v === 0 ? 'old' : 'ok'); })
  .catch(() => console.log('empty'))
  .finally(() => p.\$disconnect());
" 2>/dev/null
}
STATE="$(demo_state)"
if [ "$STATE" = "empty" ]; then
  say "Loading demo data (about 30 seconds)"
  node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$executeRawUnsafe('CREATE DATABASE controlroom_test').catch(() => {}).finally(() => p.\$disconnect());
"
  npm run setup
elif [ "$STATE" = "old" ]; then
  say "Updating the database and reloading demo data for the supplier portal (about 30 seconds)"
  npm run setup
else
  npx prisma migrate deploy >/dev/null
fi
[ "$(demo_state)" = "ok" ] || fail "Demo data did not load. Scroll up in this terminal for the error."

if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  export APP_URL="$URL"
else
  URL="http://localhost:3000"
fi

# Stop any copy of the app that is still running (e.g. from an earlier `npm run dev`).
pkill -f "next dev -p 3000" 2>/dev/null || true
pkill -f "tsx worker/index.ts" 2>/dev/null || true
sleep 1

say "Starting the app (the link appears when it is ready)"
npm run dev &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null; exit 0' INT TERM

# Wait until the web server answers, then load the sign-in page once so the first visit is fast.
for i in $(seq 1 180); do
  node -e "require('http').get('http://localhost:3000/login',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))" 2>/dev/null && break
  kill -0 $DEV_PID 2>/dev/null || fail "The app stopped while starting. Scroll up in this terminal for the error."
  sleep 2
done

printf "\n\033[1;32m============================================================\033[0m\n"
printf "\033[1;32m  Control Room is READY. Open this link in your browser:\033[0m\n\n"
printf "    \033[1;4m%s\033[0m\n\n" "$URL"
printf "  Sign in: click \"Dana Whitfield, Controller\" (password demo1234)\n"
printf "  Supplier portal: %s/portal/login (click \"Priya Raman\")\n" "$URL"
printf "  Keep this terminal open while you use the app.\n"
printf "\033[1;32m============================================================\033[0m\n\n"

wait $DEV_PID
