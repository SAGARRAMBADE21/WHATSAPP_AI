# AWS Deployment Guide — WhatsApp AI Assistant

This guide deploys the **Workspace Navigator** app to a single AWS EC2 instance using Docker Compose.

---

## 1. Launch an EC2 Instance

1. Go to **AWS Console → EC2 → Launch Instance**
2. **AMI**: Ubuntu Server 22.04 LTS (free tier eligible)
3. **Instance type**: `t3.small` (1 vCPU, 2 GB RAM) — minimum recommended
4. **Key pair**: Create or select an existing `.pem` key
5. **Security Group** — add inbound rules:

| Port | Protocol | Source    | Purpose            |
|------|----------|-----------|--------------------|
| 22   | TCP      | Your IP   | SSH access         |
| 80   | TCP      | 0.0.0.0/0 | HTTP (Nginx)       |
| 443  | TCP      | 0.0.0.0/0 | HTTPS (optional)   |
| 3000 | TCP      | 0.0.0.0/0 | App (direct access)|

6. **Storage**: 20 GB gp3 (default is fine)
7. Launch the instance and note the **Public IPv4 address**

---

## 2. SSH Into the Instance

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

---

## 3. Install Docker & Docker Compose

```bash
# Update packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker          # apply group change without logout

# Verify
docker --version
docker compose version
```

---

## 4. Clone the Repository

```bash
# Option A: Clone from GitHub (if you've pushed it)
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Option B: SCP from local machine (if not on GitHub)
# Run this from your LOCAL machine (Windows PowerShell):
# scp -i your-key.pem -r C:\Users\SAGAR\Downloads\whatsapp_slack ubuntu@<EC2-IP>:~/whatsapp_slack
# Then on EC2:
# cd ~/whatsapp_slack
```

---

## 5. Configure Environment Variables

```bash
cp .env.example .env
nano .env
```

Update these values in `.env`:

```env
OPENAI_API_KEY=sk-...               # Your OpenAI key
OPENAI_MODEL=gpt-4o

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# ⚠️ IMPORTANT: Use your EC2 public IP or domain here
GOOGLE_REDIRECT_URI=http://<EC2-PUBLIC-IP>:3000/oauth2callback

# If using Docker Compose's internal MongoDB (default):
MONGODB_URI=mongodb://mongo:27017
MONGODB_DB_NAME=workspace_navigator

# If using MongoDB Atlas (recommended for production):
# MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net
```

> **Google Cloud Console**: Add `http://<EC2-PUBLIC-IP>:3000/oauth2callback`
> as an Authorized Redirect URI in your OAuth 2.0 credentials.

---

## 6. Deploy with Docker Compose

```bash
# Build and start all services in the background
docker compose up -d --build

# View live logs
docker compose logs -f app

# Check service health
docker compose ps
```

The app will be accessible at: **`http://<EC2-PUBLIC-IP>:3000`**

---

## 7. (Alternative) Deploy with PM2 (No Docker)

If you prefer not to use Docker:

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# In the project directory:
npm ci
npm run build
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.js
pm2 save               # auto-start on reboot
pm2 startup            # follow the printed command

# View logs
pm2 logs whatsapp-ai
```

---

## 8. (Optional) Nginx Reverse Proxy

Serve on port 80 instead of 3000:

```bash
sudo apt-get install -y nginx

sudo tee /etc/nginx/sites-available/whatsapp-ai > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;          # Replace _ with your domain if you have one

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";   # Required for Socket.IO
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/whatsapp-ai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

Now the app is accessible at `http://<EC2-PUBLIC-IP>` (port 80).

---

## 9. (Optional) Add HTTPS with Let's Encrypt

Requires a **domain name** pointing to your EC2 IP:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
# Follow prompts — certbot auto-updates your nginx config
```

---

## 10. Useful Management Commands

```bash
# Docker Compose
docker compose ps                   # Check service status
docker compose logs -f app          # Live app logs
docker compose restart app          # Restart app only
docker compose pull && docker compose up -d --build  # Update & redeploy
docker compose down                 # Stop everything

# PM2 (if using PM2 instead)
pm2 status
pm2 logs whatsapp-ai
pm2 restart whatsapp-ai
pm2 stop whatsapp-ai
```

---

## Architecture Summary

```
EC2 Instance (Ubuntu 22.04)
├── Docker Compose
│   ├── whatsapp-ai (port 3000) ──────────────────────────┐
│   │   ├── Volume: whatsapp_auth → /app/auth/baileys_auth │
│   │   └── Volume: app_data     → /app/data/memory        │
│   └── whatsapp-mongo (internal only)                      │
│       └── Volume: mongo_data   → /data/db                 │
└── Nginx (port 80) → proxy_pass → localhost:3000 ──────────┘

External APIs: OpenAI · Google Workspace · WhatsApp Web
```

> **⚠️ Important**: Keep to a **single EC2 instance**. WhatsApp sessions are
> tied to disk-based auth state and cannot be shared across multiple instances.
