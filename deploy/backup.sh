#!/usr/bin/env bash
# P1.16 / N4: шөнө бүрийн шифрлэсэн нөөц → Google Drive "Mindmap/backups", 30 хоног хадгална.
# setup-backup.sh суулгасан systemd timer (huyagtan-backup.timer) 03:00 (Улаанбаатар)-д ажиллуулна.
set -euo pipefail

APP_DIR="/var/www/huyagtan.mn"
CONF_DIR="/etc/huyagtan"
REMOTE="${BACKUP_REMOTE:-gdrive:Mindmap/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | cut -d= -f2-)
RECIPIENT=$(cat "$CONF_DIR/backup.pub")

STAMP=$(TZ=Asia/Ulaanbaatar date +%Y-%m-%d_%H%M)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FILE="$TMP/huyagtan_$STAMP.dump.age"

# Шифрлэлт нийтийн түлхүүрээр: сервер дээр тайлах түлхүүр БАЙХГҮЙ. Drive дээрх файл түлхүүргүйгээр уншигдахгүй.
pg_dump --format=custom --no-owner "$DATABASE_URL" | age -r "$RECIPIENT" -o "$FILE"
SIZE=$(stat -c %s "$FILE")
[ "$SIZE" -gt 1000 ] || { echo "Нөөц файл хэт жижиг ($SIZE байт)"; exit 1; }

rclone --config "$CONF_DIR/rclone.conf" copy "$FILE" "$REMOTE"
rclone --config "$CONF_DIR/rclone.conf" delete --min-age "${KEEP_DAYS}d" "$REMOTE"
echo "Нөөц амжилттай: $(basename "$FILE") ($SIZE байт) → $REMOTE"
