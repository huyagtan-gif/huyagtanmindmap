#!/usr/bin/env bash
# One-time setup for the huyagtan.mn VPS (Ubuntu 24.04). Run as root:
#   sudo bash setup-server.sh you@example.com
# Installs Node.js 22, Nginx and Certbot, creates the "deploy" user that
# GitHub Actions logs in as, a systemd service for the Next.js app, and HTTPS.
set -euo pipefail

DOMAIN="huyagtan.mn"
EMAIL="${1:-}"
APP_DIR="/var/www/$DOMAIN"
DEPLOY_USER="deploy"

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)"; exit 1; fi

apt-get update
apt-get install -y curl ca-certificates rsync nginx certbot python3-certbot-nginx ufw

# Node.js 22
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Swap: 1 GB RAM is tight, add 1 GB swap as a safety net
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Deploy user + SSH key for GitHub Actions
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /home/$DEPLOY_USER/.ssh
KEY=/home/$DEPLOY_USER/.ssh/github_actions
if [ ! -f "$KEY" ]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "github-actions@$DOMAIN" -f "$KEY"
  cat "$KEY.pub" >> /home/$DEPLOY_USER/.ssh/authorized_keys
  chown "$DEPLOY_USER:$DEPLOY_USER" /home/$DEPLOY_USER/.ssh/authorized_keys
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
fi

# App directories
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/releases"

# Let the deploy user restart only this service
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart huyagtan" > /etc/sudoers.d/huyagtan-deploy
chmod 440 /etc/sudoers.d/huyagtan-deploy

# systemd service
cat > /etc/systemd/system/huyagtan.service <<UNIT
[Unit]
Description=huyagtan.mn Next.js app
After=network.target

[Service]
User=$DEPLOY_USER
WorkingDirectory=$APP_DIR/current
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
EnvironmentFile=-$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable huyagtan

# Nginx reverse proxy
cat > /etc/nginx/sites-available/$DOMAIN <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
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
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Firewall
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable

# HTTPS
if [ -n "$EMAIL" ]; then
  certbot --nginx -n --agree-tos -m "$EMAIL" -d "$DOMAIN" -d "www.$DOMAIN" --redirect \
    || echo "Certbot failed. Check DNS for $DOMAIN and www.$DOMAIN, then re-run: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
else
  echo "No email given, skipped HTTPS. Re-run with your email to enable it."
fi

echo
echo "Done. Copy the private key below into the GitHub secret SSH_PRIVATE_KEY:"
echo "   sudo cat $KEY"
