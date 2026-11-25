#!/usr/bin/env bash
# Phase 1 (P1.1): PostgreSQL 16-г huyagtan.mn VPS дээр (Ubuntu 24.04, 1 GB+ RAM) суулгаж, апп-ын .env-ийг бэлдэнэ.
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

# --- PostgreSQL 16, зөвхөн localhost. Санах ойн тохиргоо серверийн RAM-аас хамаарна (Phase 5: 2 GB+ руу өргөтгөх) ---
# RAM нэмсний дараа энэ скриптийг дахин ажиллуулбал PostgreSQL болон апп-ын санах ойн хязгаар шинэчлэгдэнэ.
apt-get update -qq
apt-get install -y postgresql postgresql-contrib >/dev/null
PGVER=$(ls /etc/postgresql | sort -n | tail -1)
RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
if [ "$RAM_MB" -ge 3500 ]; then          # 4 GB
  PG_CONN=60; PG_SB=1GB; PG_ECS=3GB; PG_WM=16MB; PG_MWM=256MB; PG_WAL=1GB; NODE_HEAP=1024; POOL=15
elif [ "$RAM_MB" -ge 1800 ]; then        # 2 GB
  PG_CONN=40; PG_SB=512MB; PG_ECS=1536MB; PG_WM=8MB; PG_MWM=128MB; PG_WAL=512MB; NODE_HEAP=640; POOL=10
else                                     # 1 GB (анхдагч)
  PG_CONN=20; PG_SB=128MB; PG_ECS=256MB; PG_WM=4MB; PG_MWM=32MB; PG_WAL=256MB; NODE_HEAP=384; POOL=6
fi
cat > "/etc/postgresql/$PGVER/main/conf.d/huyagtan.conf" <<CONF
# setup-db.sh үүсгэв (RAM ${RAM_MB} MB)
listen_addresses = 'localhost'
max_connections = $PG_CONN
shared_buffers = $PG_SB
effective_cache_size = $PG_ECS
work_mem = $PG_WM
maintenance_work_mem = $PG_MWM
wal_buffers = 16MB
max_wal_size = $PG_WAL
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
# Апп-ын санах ой, сангийн холболтын тоог RAM-д тааруулна. Гараар өөр утга тавьсан бол хэвээр үлдээнэ.
set_env() {   # $1 нэр, $2 шинэ утга, $3 өмнө нь энэ скриптийн тавьдаг утга (зөвхөн тэр үед солино)
  if ! grep -q "^$1=" "$ENV_FILE"; then echo "$1=$2" >> "$ENV_FILE"
  elif grep -qx "$1=$3" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; fi
  return 0
}
for H in 384 640 1024; do set_env NODE_OPTIONS "--max-old-space-size=$NODE_HEAP" "--max-old-space-size=$H"; done
for P in 6 10 15; do set_env PG_POOL_MAX "$POOL" "$P"; done
[ -n "$ADMIN_EMAIL" ] && add_env SUPER_ADMIN_EMAIL "$ADMIN_EMAIL"

# Deploy хэрэглэгч апп-ын логоос нэвтрэх холбоос харах (имэйл тохируулаагүй үед) болон health шалгах эрх аль хэдийн бий.
echo
echo "Бэлэн. PostgreSQL $PGVER ажиллаж байна (RAM ${RAM_MB} MB-д тохируулсан), $ENV_FILE шинэчлэгдлээ."
if systemctl is-active --quiet huyagtan; then echo "Апп-ын шинэ санах ойн хязгаарыг хэрэглэхийн тулд: sudo systemctl restart huyagtan"; fi
echo "Дараагийн алхам: deploy/README.md-ийн «Phase 1» хэсгийг үзнэ үү (имэйл тохиргоо, PR-ыг merge хийх)."
grep -q '^SUPER_ADMIN_EMAIL=' "$ENV_FILE" || echo "АНХААР: супер админы имэйл өгөөгүй. $ENV_FILE-д SUPER_ADMIN_EMAIL=... мөр нэмнэ үү."
grep -q '^EMAIL_SERVER=' "$ENV_FILE" || echo "АНХААР: EMAIL_SERVER тохируулаагүй. Нэвтрэх холбоос имэйлээр явахгүй (README үз)."
