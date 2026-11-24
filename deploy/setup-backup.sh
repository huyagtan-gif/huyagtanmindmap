#!/usr/bin/env bash
# P1.16: шөнө бүрийн нөөцлөлтийг тохируулна. root-оор нэг удаа:
#   sudo bash setup-backup.sh
# Өмнө нь: Google Drive-ийн rclone тохиргоог /etc/huyagtan/rclone.conf-д хийсэн байх ёстой (deploy/README.md «Нөөцлөлт»).
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "root-оор ажиллуулна уу (sudo)"; exit 1; fi

CONF_DIR="/etc/huyagtan"
apt-get install -y age rclone postgresql-client >/dev/null
install -d -m 700 "$CONF_DIR"

if [ ! -f "$CONF_DIR/backup.pub" ]; then
  KEY=$(mktemp)
  age-keygen -o "$KEY" 2>/dev/null
  grep -o 'age1[a-z0-9]*' "$KEY" | head -1 > "$CONF_DIR/backup.pub"
  echo
  echo "================= НӨӨЦ ТАЙЛАХ НУУЦ ТҮЛХҮҮР ================="
  grep '^AGE-SECRET-KEY' "$KEY"
  echo "============================================================"
  echo "Энэ мөрийг ОДОО нууц үгийн менежер эсвэл цаасан дээр хадгална уу."
  echo "Сервер дээр хадгалагдахгүй. Алдвал нөөцийг сэргээх боломжгүй болно."
  echo
  shred -u "$KEY"
fi

install -m 755 "$(dirname "$0")/backup.sh" /usr/local/bin/huyagtan-backup 2>/dev/null \
  || curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/main/deploy/backup.sh -o /usr/local/bin/huyagtan-backup
chmod 755 /usr/local/bin/huyagtan-backup

cat > /etc/systemd/system/huyagtan-backup.service <<UNIT
[Unit]
Description=huyagtan.mn encrypted DB backup to Google Drive
After=postgresql.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/huyagtan-backup
UNIT
cat > /etc/systemd/system/huyagtan-backup.timer <<UNIT
[Unit]
Description=Nightly huyagtan.mn backup (03:00 Asia/Ulaanbaatar)

[Timer]
OnCalendar=*-*-* 03:00:00 Asia/Ulaanbaatar
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now huyagtan-backup.timer >/dev/null

if [ -f "$CONF_DIR/rclone.conf" ]; then
  echo "Туршилтын нөөц авч байна..."
  systemctl start huyagtan-backup.service && journalctl -u huyagtan-backup -n 3 --no-pager
else
  echo "АНХААР: $CONF_DIR/rclone.conf алга. Google Drive-ийг холбосны дараа: sudo systemctl start huyagtan-backup"
fi
