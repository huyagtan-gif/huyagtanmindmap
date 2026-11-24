#!/usr/bin/env bash
# Phase 1 (P1.1): PostgreSQL 16-г huyagtan.mn VPS дээр (Ubuntu 24.04, 1 GB RAM) суулгаж, апп-ын .env-ийг бэлдэнэ.
# setup-server.sh, setup-runner.sh-ийн ДАРАА, root-оор нэг удаа ажиллуулна (дахин ажиллуулахад аюулгүй):
#   sudo bash setup-db.sh супер-админы@имэйл.mn
set -euo pipefail

ADMIN_EMAIL="${1:-}"
APP_DIR="/var/www/huyagtan.mn"
ENV_FILE="$APP_DIR/.env"
DEPLOY_USER="deploy"
DB="huyagtan"

if [ "$(id -u)" -ne 0 ]; then echo "root-оор ажиллуулна уу (sudo)"; exit 1; fi

# --- Swap 2 GB (N3) ---
SWAP_MB=$(free -m | awk '/^Swap:/ {print $2}')
if [ "${SWAP_MB:-0}" -lt 1900 ]; then
  swapoff /swapfile 2>/dev/null || true
  rm -f /swapfile
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
echo 'vm.swappiness=10' > /etc/sysctl.d/99-huyagtan.conf

# --- PostgreSQL 16, зөвхөн localhost, бага санах ойн тохиргоо ---
apt-get update -qq
apt-get install -y postgresql postgresql-contrib >/dev/null
PGVER=$(ls /etc/postgresql | sort -n | tail -1)
cat > "/etc/postgresql/$PGVER/main/conf.d/huyagtan.conf" <<CONF
listen_addresses = 'localhost'
max_connections = 20
shared_buffers = 128MB
effective_cache_size = 256MB
work_mem = 4MB
maintenance_work_mem = 32MB
wal_buffers = 4MB
max_wal_size = 256MB
random_page_cost = 1.1
log_min_duration_statement = 500
CONF
systemctl enable postgresql >/dev/null
systemctl restart postgresql

# --- Role, сан ---
# huyagtan      : хүснэгтийн эзэмшигч (миграци, нэвтрэлт)
# huyagtan_app  : хүсэлт бүр энэ role руу шилжиж RLS үйлчилнэ (нэвтрэх эрхгүй)
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
touch "$ENV_FILE"; chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
if ! grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huyagtan_app') THEN CREATE ROLE huyagtan_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB') THEN CREATE ROLE $DB LOGIN; END IF;
END \$\$;
ALTER ROLE $DB PASSWORD '$PASS';
GRANT huyagtan_app TO $DB;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1 \
    || sudo -u postgres createdb -O "$DB" -E UTF8 "$DB"
  echo "DATABASE_URL=postgres://$DB:$PASS@127.0.0.1:5432/$DB" >> "$ENV_FILE"
fi
add_env() { grep -q "^$1=" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"; }
add_env AUTH_SECRET "$(openssl rand -base64 32)"
add_env AUTH_URL "https://huyagtan.mn"
add_env NODE_OPTIONS "--max-old-space-size=384"
add_env PG_POOL_MAX "6"
[ -n "$ADMIN_EMAIL" ] && add_env SUPER_ADMIN_EMAIL "$ADMIN_EMAIL"

# Deploy хэрэглэгч апп-ын логоос нэвтрэх холбоос харах (имэйл тохируулаагүй үед) болон health шалгах эрх аль хэдийн бий.
echo
echo "Бэлэн. PostgreSQL $PGVER ажиллаж байна, $ENV_FILE шинэчлэгдлээ."
echo "Дараагийн алхам: deploy/README.md-ийн «Phase 1» хэсгийг үзнэ үү (имэйл тохиргоо, PR-ыг merge хийх)."
grep -q '^SUPER_ADMIN_EMAIL=' "$ENV_FILE" || echo "АНХААР: супер админы имэйл өгөөгүй. $ENV_FILE-д SUPER_ADMIN_EMAIL=... мөр нэмнэ үү."
grep -q '^EMAIL_SERVER=' "$ENV_FILE" || echo "АНХААР: EMAIL_SERVER тохируулаагүй. Нэвтрэх холбоос имэйлээр явахгүй (README үз)."
