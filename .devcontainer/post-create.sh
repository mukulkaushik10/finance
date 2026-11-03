#!/usr/bin/env bash
# Runs once when the codespace is created: install, migrate, seed.
set -euo pipefail

echo "==> Control Room: setting up (about 3 minutes)"
[ -f .env ] || cp .env.example .env

echo "==> Waiting for the database"
for i in $(seq 1 60); do
  node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
  sleep 1
done

echo "==> Installing dependencies"
npm ci
npx prisma generate

echo "==> Creating the test database (for npm test)"
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$executeRawUnsafe('CREATE DATABASE controlroom_test').catch(() => {}).finally(() => p.\$disconnect());
"

echo "==> Applying migrations and loading demo data"
npm run setup

echo ""
echo "Done. The app starts automatically (npm run dev) and opens on port 3000."
echo "Sign in as 'Dana Whitfield, Controller' (password for every demo account: demo1234)."
