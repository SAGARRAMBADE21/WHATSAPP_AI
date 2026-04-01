# ChatFuse — Full EC2 Deployment Guide

> Complete step-by-step guide to deploy the WhatsApp AI ChatFuse on AWS EC2 with a custom domain and SSL.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Launch EC2 Instance](#2-launch-ec2-instance)
3. [Connect to EC2 from PowerShell](#3-connect-to-ec2-from-powershell)
4. [Server Initial Setup](#4-server-initial-setup)
5. [Clone Repository & Configure](#5-clone-repository--configure)
6. [Docker Build & Run](#6-docker-build--run)
7. [Domain & DNS Setup](#7-domain--dns-setup)
8. [Nginx Reverse Proxy](#8-nginx-reverse-proxy)
9. [SSL Certificate (HTTPS)](#9-ssl-certificate-https)
10. [Google OAuth Configuration](#10-google-oauth-configuration)
11. [MongoDB Session Management](#11-mongodb-session-management)
12. [Troubleshooting](#12-troubleshooting)
13. [Maintenance Commands](#13-maintenance-commands)

---

## 1. Prerequisites

- **AWS Account** (Free Tier eligible)
- **Domain Name** (e.g., forgeai.works from name.com or any registrar)
- **MongoDB Atlas** cluster with connection string
- **Google Cloud Console** project with OAuth 2.0 credentials
- **OpenAI API Key**
- **Git repository** pushed to GitHub
- **PowerShell** (Windows) or Terminal (Mac/Linux)
- **SSH Key Pair** (.pem file from AWS)

---

## 2. Launch EC2 Instance

### In AWS Console:

1. Go to **AWS Console** → **EC2** → **Launch Instance**
2. Configure:
   - **Name:** `whatsapp-ai`
   - **AMI:** Ubuntu Server 24.04 LTS (Free Tier eligible)
   - **Instance Type:** `t2.micro` (Free Tier) or `t2.small` (recommended)
   - **Key Pair:** Create new → Download `.pem` file → Save securely
   - **Network Settings:**
     - Allow SSH (port 22)
     - Allow HTTP (port 80)
     - Allow HTTPS (port 443)
3. Click **Launch Instance**

### Configure Security Group:

1. Go to **EC2** → **Security Groups** → Click your instance's security group
2. Click **Edit inbound rules** → Add these rules:

| Type       | Port  | Source    |
|------------|-------|-----------|
| SSH        | 22    | My IP     |
| HTTP       | 80    | 0.0.0.0/0 |
| HTTPS      | 443   | 0.0.0.0/0 |
| Custom TCP | 3000  | 0.0.0.0/0 |

3. Click **Save rules**

### Get Your Public IP:

- Go to **EC2** → **Instances** → Click your instance
- Copy the **Public IPv4 address** (e.g., `43.205.202.70`)

---

## 3. Connect to EC2 from PowerShell

### First Time — Set Key Permissions:

```powershell
# Navigate to where your .pem file is saved
cd C:\Users\YourUsername\Downloads

# Set proper permissions on the key file (Windows)
icacls "whatsapp-ai-key.pem" /reset
icacls "whatsapp-ai-key.pem" /grant:r "%USERNAME%:R"
icacls "whatsapp-ai-key.pem" /inheritance:r
```

### Connect via SSH:

```powershell
ssh -i "whatsapp-ai-key.pem" ubuntu@<your-ec2-public-ip>
```

**Example:**
```powershell
ssh -i "whatsapp-ai-key.pem" ubuntu@43.205.202.70
```

- Type `yes` when asked about fingerprint
- You're now logged into your EC2 server

### Reconnecting Later:

```powershell
ssh -i "C:\Users\YourUsername\Downloads\whatsapp-ai-key.pem" ubuntu@43.205.202.70
```

---

## 4. Server Initial Setup

Run these commands on your EC2 server after connecting:

### Update System:

```bash
sudo apt update && sudo apt upgrade -y
```

### Install Docker:

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (optional, avoids using sudo)
sudo usermod -aG docker ubuntu

# Install Docker Compose (if needed)
sudo apt install -y docker-compose-plugin

# Verify installation
docker --version
```

### Install Git:

```bash
sudo apt install -y git
```

### Install Nginx & Certbot (for domain + SSL):

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 5. Clone Repository & Configure

### Clone from GitHub:

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/WHATSAPP_AI.git
cd WHATSAPP_AI
```

### Create .env File:

```bash
nano .env
```

Paste your environment variables:

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-proj-your-openai-key
OPENAI_MODEL=gpt-4o

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_REDIRECT_URI=http://your-domain.com/oauth2callback
GOOGLE_TOKEN_PATH=./auth/google_tokens.json

# MongoDB Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
MONGODB_DB_NAME=workspace_navigator

# WhatsApp Configuration
ALLOWED_NUMBERS=
OWNER_NUMBER=your-phone-number
AUTH_STATE_PATH=./auth/baileys_auth

# Memory & Storage
MEMORY_DB_PATH=./data/memory/navigator.db

# E2B Sandbox
E2B_API_KEY=your-e2b-key

# Logging
LOG_LEVEL=warn

# Security Secrets
JWT_SECRET=your-random-64-char-hex-string
ENCRYPTION_KEY=your-random-64-char-hex-string
```

Save: `Ctrl+O` → `Enter` → `Ctrl+X`

> **IMPORTANT:** Never push .env to GitHub. It contains secrets.

---

## 6. Docker Build & Run

### Build the Docker Image:

```bash
sudo docker buildx build -t whatsapp_ai-app .
```

This takes ~2 minutes. Wait for "FINISHED" message.

### Run the Container:

```bash
sudo docker run -d --name whatsapp_ai-app --env-file .env -p 3000:3000 whatsapp_ai-app
```

### Verify It's Running:

```bash
# Check container status
sudo docker ps

# Check app logs
sudo docker logs whatsapp_ai-app --tail 50

# Test locally
curl -I http://localhost:3000
```

You should see `HTTP/1.1 200 OK`.

---

## 7. Domain & DNS Setup

### On Your Domain Registrar (e.g., name.com):

1. Log in → **My Domains** → Click your domain
2. Go to **DNS Records**
3. Add these A records:

| Type | Host    | Answer/Value      | TTL |
|------|---------|-------------------|-----|
| A    | @ (blank) | 43.205.202.70   | 300 |
| A    | www     | 43.205.202.70     | 300 |

4. Delete any existing A records pointing to a different IP
5. Wait 5-30 minutes for DNS propagation

### Verify DNS Propagation:

```bash
# On your server
dig forgeai.works +short
# Should return: 43.205.202.70
```

Or check from your local machine:
```powershell
nslookup forgeai.works
```

---

## 8. Nginx Reverse Proxy

### Create Nginx Config:

```bash
sudo bash -c 'cat > /etc/nginx/sites-available/forgeai << EOF
server {
    listen 80;
    server_name forgeai.works www.forgeai.works;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF'
```

> **Note:** Replace `forgeai.works` with your actual domain if different.

### Enable the Site:

```bash
# Create symlink to enable the site
sudo ln -s /etc/nginx/sites-available/forgeai /etc/nginx/sites-enabled/

# Remove default nginx site
sudo rm -f /etc/nginx/sites-enabled/default

# Test config syntax
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
```

### Verify HTTP Works:

Open `http://forgeai.works` in your browser. You should see the landing page.

---

## 9. SSL Certificate (HTTPS)

### Get Free SSL with Let's Encrypt:

```bash
sudo certbot --nginx -d forgeai.works -d www.forgeai.works
```

- Enter your email address when prompted
- Type `Y` to agree to terms
- Type `N` or `Y` for EFF newsletter (your choice)

Certbot will automatically:
- Obtain the SSL certificate
- Configure Nginx for HTTPS
- Set up HTTP → HTTPS redirect
- Configure auto-renewal

### Verify HTTPS:

Open `https://forgeai.works` — you should see a lock icon in the browser.

### Auto-Renewal (already set up by certbot):

```bash
# Test auto-renewal
sudo certbot renew --dry-run
```

Certificates renew automatically every 90 days.

---

## 10. Google OAuth Configuration

### In Google Cloud Console:

1. Go to **console.cloud.google.com**
2. Select your project
3. Go to **APIs & Services** → **Credentials**
4. Click your **OAuth 2.0 Client ID**

### Add Authorized JavaScript Origins:

```
http://forgeai.works
https://forgeai.works
```

### Add Authorized Redirect URIs:

```
http://forgeai.works/oauth2callback
https://forgeai.works/oauth2callback
http://forgeai.works/auth/callback
https://forgeai.works/auth/callback
```

5. Click **Save**

### Update .env on Server:

```bash
cd ~/WHATSAPP_AI
sed -i 's|GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=https://forgeai.works/oauth2callback|' .env
```

### Restart Container After .env Change:

```bash
sudo docker stop whatsapp_ai-app && sudo docker rm whatsapp_ai-app
sudo docker run -d --name whatsapp_ai-app --env-file .env -p 3000:3000 whatsapp_ai-app
```

---

## 11. MongoDB Session Management

### Clear Corrupted WhatsApp Session Data:

If you get "Bad MAC" or "Unsupported state" errors:

```bash
sudo docker exec whatsapp_ai-app node -e "
const{MongoClient}=require('mongodb');
const c=new MongoClient(process.env.MONGODB_URI);
c.connect().then(async()=>{
  const db=c.db(process.env.MONGODB_DB_NAME||'workspace_navigator');
  console.log(await db.collection('baileys_auth').deleteMany({}));
  console.log(await db.collection('sessions').deleteMany({}));
  await c.close();
});"
```

Then restart the container:

```bash
sudo docker restart whatsapp_ai-app
```

### Clear Corrupted Encrypted API Keys:

If you get "unable to authenticate data" decryption errors:

```bash
sudo docker exec whatsapp_ai-app node -e "
const{MongoClient}=require('mongodb');
const c=new MongoClient(process.env.MONGODB_URI);
c.connect().then(async()=>{
  const db=c.db(process.env.MONGODB_DB_NAME||'workspace_navigator');
  const r=await db.collection('users').updateMany({},{
    \$unset:{manus_api_key:'',v0_api_key:''}
  });
  console.log('Cleared encrypted keys from',r.modifiedCount,'users');
  await c.close();
});"
```

---

## 12. Troubleshooting

### Container Won't Start:

```bash
# Check logs
sudo docker logs whatsapp_ai-app --tail 100

# Check if port is in use
sudo lsof -i :3000

# Remove old container and retry
sudo docker stop whatsapp_ai-app && sudo docker rm whatsapp_ai-app
sudo docker run -d --name whatsapp_ai-app --env-file .env -p 3000:3000 whatsapp_ai-app
```

### "Container name already in use" Error:

```bash
sudo docker stop whatsapp_ai-app && sudo docker rm whatsapp_ai-app
```

Then run `docker run` again.

### "Permission denied" Docker Error:

```bash
# Always use sudo with docker
sudo docker buildx build -t whatsapp_ai-app .
sudo docker run -d --name whatsapp_ai-app --env-file .env -p 3000:3000 whatsapp_ai-app
```

### Site Shows "Connection Timed Out":

- Port not open in EC2 Security Group → Add the port in AWS Console
- Check: **EC2** → **Security Groups** → **Edit inbound rules**

### Site Shows "Connection Refused":

- Nginx not running: `sudo systemctl restart nginx`
- Container not running: `sudo docker ps` → restart if needed
- SSL not set up: Run certbot (Step 9)

### Site Shows "404 Not Found":

- App is running but public files not found
- Rebuild the Docker image with latest code and redeploy

### Site Shows "502 Bad Gateway":

- Container crashed: `sudo docker logs whatsapp_ai-app --tail 50`
- Restart: `sudo docker restart whatsapp_ai-app`

### WhatsApp "Bad MAC" / "Unsupported State" Errors:

- Session keys corrupted → Clear MongoDB session data (see Step 11)
- Scan QR code again after clearing

### Google OAuth "Access Blocked" Error:

- Redirect URI mismatch → Update in Google Cloud Console (see Step 10)
- Update `GOOGLE_REDIRECT_URI` in `.env` to match your domain

### Build Fails with "Could not resolve" Error:

- Check `.gitignore` isn't excluding source files
- Verify with: `git ls-files src/`
- If files missing: fix `.gitignore`, commit, push, pull on server

---

## 13. Maintenance Commands

### Daily Operations:

```bash
# Check container status
sudo docker ps

# View live logs
sudo docker logs -f whatsapp_ai-app

# View last 50 log lines
sudo docker logs whatsapp_ai-app --tail 50

# Restart container
sudo docker restart whatsapp_ai-app

# Check server disk space
df -h

# Check memory usage
free -h
```

### Deploying Updates:

```bash
cd ~/WHATSAPP_AI

# Pull latest code
git pull

# Stop and remove old container
sudo docker stop whatsapp_ai-app && sudo docker rm whatsapp_ai-app

# Rebuild image
sudo docker buildx build -t whatsapp_ai-app .

# Run new container
sudo docker run -d --name whatsapp_ai-app --env-file .env -p 3000:3000 whatsapp_ai-app

# Verify
sudo docker logs whatsapp_ai-app --tail 30
```

### Nginx Management:

```bash
# Test config
sudo nginx -t

# Restart
sudo systemctl restart nginx

# View nginx logs
sudo tail -f /var/log/nginx/error.log
```

### SSL Certificate:

```bash
# Check certificate expiry
sudo certbot certificates

# Manual renewal
sudo certbot renew

# Test auto-renewal
sudo certbot renew --dry-run
```

### Server Monitoring:

```bash
# Get public IP
curl ifconfig.me

# Check all running containers
sudo docker ps -a

# Check disk usage by Docker
sudo docker system df

# Clean up unused Docker images
sudo docker system prune -f
```

---

## Quick Reference — Full Deployment in Order

```bash
# 1. Connect to EC2
ssh -i "your-key.pem" ubuntu@your-ec2-ip

# 2. Install dependencies
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
sudo apt install -y git nginx certbot python3-certbot-nginx

# 3. Clone and configure
git clone https://github.com/YOUR_USERNAME/WHATSAPP_AI.git
cd WHATSAPP_AI
nano .env  # paste your environment variables

# 4. Build and run
sudo docker buildx build -t whatsapp_ai-app .
sudo docker run -d --name whatsapp_ai-app --env-file .env -p 3000:3000 whatsapp_ai-app

# 5. Setup Nginx
sudo bash -c 'cat > /etc/nginx/sites-available/forgeai << EOF
server {
    listen 80;
    server_name forgeai.works www.forgeai.works;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF'
sudo ln -s /etc/nginx/sites-available/forgeai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# 6. SSL
sudo certbot --nginx -d forgeai.works -d www.forgeai.works

# 7. Verify
curl -I https://forgeai.works
```

---

## Architecture Overview

```
User Browser / Phone
        │
        ▼
   forgeai.works (DNS A record → EC2 IP)
        │
        ▼
   Nginx (port 80/443) ── SSL termination
        │
        ▼
   Docker Container (port 3000)
   ├── Node.js App (ChatFuse)
   ├── WhatsApp (Baileys) ── WebSocket to WhatsApp servers
   ├── Socket.IO ── Real-time dashboard updates
   └── MongoDB Atlas ── User data, sessions, memory
```

---

*Last updated: 2026-04-01*
