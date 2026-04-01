#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — ChatFuse AWS EC2 Setup & Deploy Script
#
# Run this ONCE on a fresh Ubuntu 22.04 EC2 instance.
# After this script, the app will be running behind Nginx on port 443 (HTTPS).
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Pre-requisites:
#   1. Ubuntu 22.04 LTS EC2 instance (t3.small or better)
#   2. Security group: ports 22, 80, 443 open
#   3. A domain name pointed to this EC2's public IP (for HTTPS)
#   4. Your .env file ready with real values
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Exit immediately on any error

REPO_URL="https://github.com/SAGARRAMBADE21/WHATSAPP_AI.git"
APP_DIR="$HOME/whatsapp_ai"
DOMAIN=""  # Fill in: e.g. "myapp.example.com"

# ─────────────────────────────
# Colors
# ─────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${BLUE}━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✖ $1${NC}"; exit 1; }

# ─────────────────────────────────────────────
# STEP 1: System Update & Essentials
# ─────────────────────────────────────────────
step "STEP 1/7: System Update"
sudo apt-get update -qq && sudo apt-get upgrade -y -qq
sudo apt-get install -y -qq git curl wget unzip
ok "System updated"

# ─────────────────────────────────────────────
# STEP 2: Install Docker
# ─────────────────────────────────────────────
step "STEP 2/7: Install Docker"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  ok "Docker installed"
else
  ok "Docker already installed: $(docker --version)"
fi

# Make docker available in this session without re-login
if ! groups | grep -q docker; then
  warn "Docker group added. Running remaining commands with sudo for this session."
  DOCKER_CMD="sudo docker"
else
  DOCKER_CMD="docker"
fi

# ─────────────────────────────────────────────
# STEP 3: Install Nginx + Certbot
# ─────────────────────────────────────────────
step "STEP 3/7: Install Nginx & Certbot"
sudo apt-get install -y -qq nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
ok "Nginx installed and enabled"

# ─────────────────────────────────────────────
# STEP 4: Clone / Pull Repository
# ─────────────────────────────────────────────
step "STEP 4/7: Get Application Code"
if [ -d "$APP_DIR/.git" ]; then
  warn "Repo already exists. Pulling latest changes..."
  cd "$APP_DIR" && git pull origin main
  ok "Code updated"
else
  git clone "$REPO_URL" "$APP_DIR"
  ok "Repository cloned to $APP_DIR"
fi

cd "$APP_DIR"

# ─────────────────────────────────────────────
# STEP 5: Create .env File
# ─────────────────────────────────────────────
step "STEP 5/7: Configure Environment"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo ""
  warn "⚠️  .env file created from template."
  warn "    You MUST edit $APP_DIR/.env before starting the app:"
  warn ""
  warn "    Required values to set:"
  warn "      OPENAI_API_KEY         — Your OpenAI key"
  warn "      GOOGLE_CLIENT_ID       — Google OAuth client ID"
  warn "      GOOGLE_CLIENT_SECRET   — Google OAuth client secret"
  warn "      GOOGLE_REDIRECT_URI    — https://YOURDOMAIN.COM/oauth2callback"
  warn "      MONGODB_URI            — mongodb+srv://user:pass@cluster.mongodb.net/workspace_navigator"
  warn "      JWT_SECRET             — Run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  warn "      ENCRYPTION_KEY         — Run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  warn "      E2B_API_KEY            — Your E2B key from e2b.dev"
  warn ""
  warn "    Edit now: nano $APP_DIR/.env"
  warn "    Then re-run this script."
  echo ""
  exit 0
else
  ok ".env file exists"
fi

# ─────────────────────────────────────────────
# STEP 6: Start Docker Container (Production)
# ─────────────────────────────────────────────
step "STEP 6/7: Start Application"

# Stop existing container if running
$DOCKER_CMD compose -f docker-compose.yml -f docker-compose.prod.yml down 2>/dev/null || true

# Build and start
$DOCKER_CMD compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Wait for health
echo "  Waiting for app to be healthy..."
for i in $(seq 1 30); do
  STATUS=$($DOCKER_CMD inspect --format='{{.State.Health.Status}}' whatsapp-ai 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    ok "Container is healthy!"
    break
  fi
  echo "  .. waiting ($i/30) — status: $STATUS"
  sleep 5
done

if [ "$STATUS" != "healthy" ]; then
  warn "Container not yet healthy. Check logs: docker logs whatsapp-ai"
fi

# ─────────────────────────────────────────────
# STEP 7: Configure Nginx
# ─────────────────────────────────────────────
step "STEP 7/7: Configure Nginx"

if [ -z "$DOMAIN" ]; then
  warn "DOMAIN variable not set in deploy.sh"
  warn "Configuring Nginx for HTTP only (no HTTPS, no domain)"

  cat > /tmp/nginx-http.conf << 'NGINXEOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    client_max_body_size 10m;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout  120s;
        proxy_send_timeout  120s;
    }

    location ~ /\. {
        deny all;
        return 404;
    }
}
NGINXEOF

  sudo cp /tmp/nginx-http.conf /etc/nginx/sites-available/whatsapp-ai
  sudo ln -sf /etc/nginx/sites-available/whatsapp-ai /etc/nginx/sites-enabled/whatsapp-ai
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
  ok "Nginx configured (HTTP only)"
  warn "To enable HTTPS later, set DOMAIN=yourdomain.com in deploy.sh and re-run"
else
  # Use the project's nginx.conf and replace placeholder domain
  sudo sed "s/yourdomain.com/$DOMAIN/g" "$APP_DIR/nginx.conf" \
    > /tmp/nginx-domain.conf
  sudo cp /tmp/nginx-domain.conf /etc/nginx/sites-available/whatsapp-ai
  sudo ln -sf /etc/nginx/sites-available/whatsapp-ai /etc/nginx/sites-enabled/whatsapp-ai
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
  ok "Nginx configured for domain: $DOMAIN"

  # Get SSL certificate
  echo ""
  echo "  Getting free SSL certificate from Let's Encrypt..."
  sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos --email "admin@$DOMAIN" \
    --redirect
  ok "SSL certificate installed"

  # Enable auto-renewal
  sudo systemctl enable certbot.timer 2>/dev/null || true
  ok "Certificate auto-renewal enabled"
fi

# ─────────────────────────────────────────────
# Done!
# ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       🎉 DEPLOYMENT COMPLETE!                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Container:    docker ps | grep whatsapp-ai"
echo "  Logs:         docker logs -f whatsapp-ai"
echo "  Restart:      docker restart whatsapp-ai"
echo "  Stop:         docker compose -f docker-compose.yml -f docker-compose.prod.yml down"
echo ""
if [ -n "$DOMAIN" ]; then
  echo "  App URL:      https://$DOMAIN"
  echo ""
  warn "NEXT STEP: Update Google Cloud Console"
  warn "  Go to: https://console.cloud.google.com → Credentials → Your OAuth Client"
  warn "  Add Authorized redirect URI: https://$DOMAIN/oauth2callback"
  warn "  Add Authorized JavaScript origin: https://$DOMAIN"
else
  EC2_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "<EC2-PUBLIC-IP>")
  echo "  App URL:      http://$EC2_IP"
  echo ""
  warn "NEXT STEP: Update Google Cloud Console"
  warn "  Add Authorized redirect URI: http://$EC2_IP:3000/oauth2callback"
fi
echo ""
