#!/usr/bin/env bash
# MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
# Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
# Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
# Installs or updates MenuAI on a Debian/Ubuntu server behind nginx.
# Usage (on the server):  sudo DOMAIN=menu.example.com bash scripts/deploy-nginx.sh
# Optional env: BRANCH (default: main), APP_DIR (/opt/menuai), WEB_ROOT (/var/www/menuai),
#               REPO (https://github.com/diamondrubinny/menuai.git), EMAIL (enables Let's Encrypt HTTPS)
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, e.g. DOMAIN=menu.example.com}"
BRANCH="${BRANCH:-main}"
REPO="${REPO:-https://github.com/diamondrubinny/menuai.git}"
APP_DIR="${APP_DIR:-/opt/menuai}"
WEB_ROOT="${WEB_ROOT:-/var/www/menuai}"
EMAIL="${EMAIL:-}"

if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
if ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then echo "Invalid DOMAIN." >&2; exit 1; fi

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq git nginx rsync ca-certificates curl >/dev/null

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  echo "==> Installing Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "==> Fetching source ($BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

echo "==> Building"
cd "$APP_DIR"
npm ci --no-audit --no-fund --loglevel=error
# Separate lines: under `set -e` a failure on the left of `&&` would not stop the script.
npx tsc -p .
npx vite build --logLevel warn

echo "==> Publishing to $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rsync -a --delete dist/ "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"

SITE=/etc/nginx/sites-available/menuai
if [[ ! -f "$SITE" ]]; then
  echo "==> Writing nginx site for $DOMAIN"
  cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $WEB_ROOT;
    index index.html;
    server_tokens off;
    client_max_body_size 1m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;

    # No add_header inside locations: it would drop the server-level security headers.
    location /assets/ {
        expires 1y;
    }
    location / {
        try_files \$uri \$uri/ /index.html;
        expires -1;
    }
}
NGINX
  ln -sf "$SITE" /etc/nginx/sites-enabled/menuai
fi

nginx -t
systemctl reload nginx

if [[ -n "$EMAIL" ]]; then
  echo "==> Enabling HTTPS (Let's Encrypt)"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"
  # HSTS only once HTTPS works.
  grep -q Strict-Transport-Security "$SITE" || \
    sed -i "0,/server_tokens off;/s//server_tokens off;\n    add_header Strict-Transport-Security \"max-age=63072000; includeSubDomains\" always;/" "$SITE"
  nginx -t
  systemctl reload nginx
fi

echo "==> Done: http${EMAIL:+s}://$DOMAIN"
