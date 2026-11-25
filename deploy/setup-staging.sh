#!/usr/bin/env bash
# Phase 2 (P2.9, N9): туршилтын орчин staging.huyagtan.mn-ийг ИЖИЛ сервер дээр, ТУСДАА сантай үүсгэнэ.
# setup-server.sh, setup-runner.sh, setup-db.sh-ийн ДАРАА, root-оор нэг удаа ажиллуулна (дахин ажиллуулахад аюулгүй):
#   sudo bash setup-staging.sh супер-админы@имэйл.mn
# Өмнө нь DNS-д  staging.huyagtan.mn  A бичлэгийг серверийн IP руу заасан байх ёстой (HTTPS гэрчилгээ авахад хэрэгтэй).
set -euo pipefail

ADMIN_EMAIL="${1:-}"
DOMAIN="staging.huyagtan.mn"
APP_DIR="/var/www/$DOMAIN"
ENV_FILE="$APP_DIR/.env"
DEPLOY_USER="deploy"
SERVICE="huyagtan-staging"
PORT=3001
DB="huyagtan_staging"

if [ "$(id -u)" -ne 0 ]; then echo "root-оор ажиллуулна уу (sudo)"; exit 1; fi
command -v psql >/dev/null || { echo "PostgreSQL алга. Эхлээд setup-db.sh ажиллуулна уу."; exit 1; }
id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "'$DEPLOY_USER' хэрэглэгч алга. Эхлээд setup-server.sh ажиллуулна уу."; exit 1; }

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/releases"
touch "$ENV_FILE"; chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"

# --- Тусдаа сан, тусдаа нэвтрэх role: staging-ийн апп үндсэн санд хүрч чадахгүй ---
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
  # Үндсэн сан руу staging-ийн role холбогдож чадахгүй
  sudo -u postgres psql -q -c "REVOKE CONNECT ON DATABASE huyagtan FROM PUBLIC" -c "GRANT CONNECT ON DATABASE huyagtan TO huyagtan" 2>/dev/null || true
  echo "DATABASE_URL=postgres://$DB:$PASS@127.0.0.1:5432/$DB" >> "$ENV_FILE"
fi
add_env() { grep -q "^$1=" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"; }
add_env AUTH_SECRET "$(openssl rand -base64 32)"
add_env AUTH_URL "https://$DOMAIN"
add_env APP_ENV "staging"                              # дэлгэцэд «Туршилтын орчин» гэсэн тэмдэглэл гарна
add_env NODE_OPTIONS "--max-old-space-size=256"       # 1 GB RAM-д үндсэн апп-аас бага санах ой
add_env PG_POOL_MAX "3"
add_env SMS_DEV_LOG "1"                                # жинхэнэ SMS явуулахгүй, кодыг логт бичнэ
[ -n "$ADMIN_EMAIL" ] && add_env SUPER_ADMIN_EMAIL "$ADMIN_EMAIL"

# --- systemd service (үндсэн апп-ыг шахахгүйн тулд санах ойн дээд хязгаартай) ---
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=$DOMAIN Next.js app (staging)
After=network.target postgresql.service

[Service]
User=$DEPLOY_USER
WorkingDirectory=$APP_DIR/current
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
EnvironmentFile=-$ENV_FILE
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
MemoryHigh=300M
MemoryMax=420M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null 2>&1 || true

# Deploy хэрэглэгч зөвхөн энэ service-ийг дахин асааж, логийг нь харж чадна
cat > /etc/sudoers.d/huyagtan-staging <<SUDO
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICE
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/journalctl -u $SERVICE *
SUDO
chmod 440 /etc/sudoers.d/huyagtan-staging
visudo -cf /etc/sudoers.d/huyagtan-staging >/dev/null

# --- Nginx ---
if [ ! -f /etc/nginx/sites-available/$DOMAIN ]; then
  cat > /etc/nginx/sites-available/$DOMAIN <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    add_header X-Robots-Tag "noindex, nofollow" always;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
fi
nginx -t && systemctl reload nginx

# --- HTTPS ---
if [ -n "$ADMIN_EMAIL" ]; then
  certbot --nginx -n --agree-tos -m "$ADMIN_EMAIL" -d "$DOMAIN" --redirect \
    || echo "АНХААР: Certbot амжилтгүй. DNS-д $DOMAIN-ийн A бичлэг энэ сервер рүү зааж буйг шалгаад дахин: certbot --nginx -d $DOMAIN"
else
  echo "АНХААР: имэйл өгөөгүй тул HTTPS тохируулаагүй. Имэйлтэйгээр дахин ажиллуулна уу."
fi

echo
echo "Бэлэн. Одоо GitHub дээр: Actions → Deploy to huyagtan.mn → Run workflow → Deploy to: staging."
echo "Эхний deploy хүртэл $DOMAIN нь 502 харуулна. Нэвтрэх холбоос (имэйл тохируулаагүй үед):"
echo "   sudo journalctl -u $SERVICE | grep 'mail:dev' | tail -1"
echo "Түр унтраах (санах ой чөлөөлөх): sudo systemctl stop $SERVICE"
