#!/usr/bin/env bash
# Restore a pg_dump custom-format backup into the production database.
# DESTRUCTIVE: drops and recreates the sahay database. Stop api+worker first.
# Usage: ops/restore.sh /var/backups/sahay/sahay-YYYYMMDD-HHMMSS.dump
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump-file>}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

read -r -p "This DROPS the live database and restores $DUMP. Type 'restore' to continue: " ok
[ "$ok" = "restore" ] || { echo "aborted"; exit 1; }

$COMPOSE stop api worker
$COMPOSE exec -T postgres psql -U sahay -d postgres -c "DROP DATABASE IF EXISTS sahay WITH (FORCE)"
$COMPOSE exec -T postgres psql -U sahay -d postgres -c "CREATE DATABASE sahay"
$COMPOSE exec -T postgres pg_restore -U sahay -d sahay --no-owner < "$DUMP"
$COMPOSE start api worker
echo "restore complete"
