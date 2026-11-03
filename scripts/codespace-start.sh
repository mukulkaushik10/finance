#!/usr/bin/env bash
# One command to run Control Room in GitHub Codespaces (or any machine with Docker):
#   bash scripts/codespace-start.sh
# Starts Postgres if needed, installs, loads demo data on first run, prints the link, runs the app.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf "\n\033[1;34m==> %s\033[0m\n" "$1"; }
pg_up() { node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; }

say "Control Room: getting ready (first time takes about 3 minutes)"
[ -f .env ] || cp .env.example .env

if ! pg_up; then
  say "Starting the database"
  if docker ps -a --format '{{.Names}}' | grep -qx controlroom-db; then
    docker start controlroom-db >/dev/null
  else
    docker run --name controlroom-db -e POSTGRES_USER=controlroom -e POSTGRES_PASSWORD=controlroom \
      -e POSTGRES_DB=controlroom -p 5432:5432 -d --restart unless-stopped postgres:16 >/dev/null
  fi
  for i in $(seq 1 60); do
    docker exec controlroom-db pg_isready -U controlroom -d controlroom >/dev/null 2>&1 && break
    sleep 1
  done
fi

if [ ! -d node_modules/@prisma/client ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing (about 1-2 minutes)"
  npm ci --no-audit --no-fund
fi
npx prisma generate >/dev/null

if [ ! -f storage/.seeded ]; then
  say "Loading demo data (about 30 seconds)"
  node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$executeRawUnsafe('CREATE DATABASE controlroom_test').catch(() => {}).finally(() => p.\$disconnect());
"
  npm run setup
  mkdir -p storage && touch storage/.seeded
fi

if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  export APP_URL="$URL"
else
  URL="http://localhost:3000"
fi

printf "\n\033[1;32m============================================================\033[0m\n"
printf "\033[1;32m  Control Room is starting. Open this link in your browser:\033[0m\n\n"
printf "    \033[1;4m%s\033[0m\n\n" "$URL"
printf "  Sign in: click \"Dana Whitfield, Controller\" (password demo1234)\n"
printf "  Keep this terminal open while you use the app.\n"
printf "\033[1;32m============================================================\033[0m\n\n"

exec npm run dev
