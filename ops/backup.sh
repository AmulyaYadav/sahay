#!/usr/bin/env bash
# Nightly logical backup of the production database. Run from the repo directory
# on the VPS via cron, e.g.:  15 2 * * *  /srv/sahay/ops/backup.sh
# Retains 14 days locally; copy offsite (rclone/rsync) as a second step.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/sahay}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
$COMPOSE exec -T postgres pg_dump -U sahay -Fc sahay > "$BACKUP_DIR/sahay-$STAMP.dump"
find "$BACKUP_DIR" -name 'sahay-*.dump' -mtime +14 -delete
echo "backup written: $BACKUP_DIR/sahay-$STAMP.dump"
