# ChatFuse

**AI-Powered Google Workspace Assistant via WhatsApp — with Cloud Sandbox & Memory**

Control your entire Google Workspace (Gmail, Calendar, Drive, Sheets, Docs, Classroom) through natural language WhatsApp messages — no app switching, no browser needed. ChatFuse is a multi-user AI agent that combines:

- **Google Workspace control** — Gmail, Calendar, Drive, Sheets, Docs, Classroom via 55+ tools
- **Manus AI integration** — delegate cloud tasks, run shell commands, take desktop screenshots, all from WhatsApp
- **v0 by Vercel integration** — generate UIs, iterate designs, deploy to Vercel, and run them live in the sandbox
- **E2B cloud sandbox** — a full Ubuntu 22.04 Linux VM per user with VS Code Server, real-time terminal, and file explorer
- **3-tier MemOS memory** — episodic, semantic, and procedural memory with a visual graph
- **Secure multi-user system** — Google OAuth 2.0 login, per-user token isolation, AES-256-GCM encrypted API keys, real-time dashboard, and automatic background token refresh

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Available Commands](#available-commands)
- [Security](#security)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)

---

## Features

### Multi-User System
- **Google OAuth Login** — Secure sign-in via Google (no passwords stored)
- **Separate Register & Sign In** pages for new and returning users
- **Per-User Isolation** — Each user gets their own Google tokens, WhatsApp session, tools, and memory
- **Real-time Dashboard** — Live connection status, activity feed, and API key management
- **JWT Sessions** — 7-day token expiry with automatic background refresh

### Gmail Management
- Send emails with natural language commands
- Create and manage drafts
- Search emails using Gmail search syntax
- Read full email content
- Delete / archive messages
- Add labels and organize inbox

### Calendar Operations
- Create events with smart date parsing
- List upcoming events
- Update and delete events
- Handle recurring events

### Google Drive
- Search for files
- Share files with specific people
- List folder contents
- Create folders and delete files

### Google Sheets
- Read data from spreadsheets
- Write data to cells or ranges
- Update individual cells and append new rows

### Google Docs
- Create new documents
- Read document content
- Append text to documents

### Google Classroom
- List courses
- View assignments
- Post announcements

### E2B Cloud Sandbox
- **Full Linux VM** (Ubuntu 22.04) per user — runs in the cloud via E2B
- **VS Code Server** — browser-based IDE auto-installed in the sandbox
- **Real-time Terminal** — run shell commands directly from the dashboard
- **Real-time File Explorer** — auto-refreshes every 3 seconds when files change
- **WhatsApp control** — send sandbox commands directly from WhatsApp:
  `"E2B sandbox: ls /home/user"` or `"In E2B sandbox, run: npm install"`
- **v0 Export to Sandbox** — fetch v0.dev project files and run them live in the sandbox
- Persistent sandbox sessions stored in MongoDB

### Manus AI Integration
Control Manus AI entirely from WhatsApp. Requires a Manus API key added on the dashboard.

| Tool | What it does |
|------|-------------|
| `manus_send` | Send a prompt to Manus cloud (agent / chat / adaptive mode) |
| `manus_hybrid` | Manus plans in cloud, controls your local machine |
| `manus_tasks` | List recent Manus tasks |
| `manus_get_task` | View output of a specific task by ID |
| `manus_projects` | List all Manus projects |
| `manus_exec` | Execute a shell command locally via Manus |
| `manus_file_list` | List files in a local directory |
| `manus_file_read` | Read contents of a local file |
| `manus_desktop_screenshot` | Take a screenshot of your desktop |
| `manus_desktop_apps` | List all running applications |
| `manus_desktop_sysinfo` | Get CPU, RAM, and OS info |

**Example WhatsApp commands:**
- *"Send to Manus: summarize all emails I received today"*
- *"Run manus hybrid: open Chrome and go to Gmail"*
- *"Show my recent Manus tasks"*
- *"Take a screenshot of my desktop"*

### v0 by Vercel Integration
Generate, iterate, and deploy UI from WhatsApp. Requires a v0 API key added on the dashboard.

| Tool | What it does |
|------|-------------|
| `v0_create_chat` | Generate a new UI/app from a prompt — returns preview URL |
| `v0_send_message` | Send a follow-up message to iterate on an existing v0 chat |
| `v0_get_files` | Get the raw generated code files from a v0 chat |
| `v0_list_chats` | List all your v0 chats and their IDs |
| `v0_delete_chat` | Delete a v0 chat permanently |
| `v0_create_project` | Create a new v0 project |
| `v0_list_projects` | List all v0 projects |
| `v0_get_project` | Get details of a specific project |
| `v0_delete_project` | Delete a v0 project |
| `v0_deploy` | Deploy a v0 project to Vercel |
| `v0_vercel_list` | List Vercel projects linked to v0 |
| `v0_rate_limits` | Check remaining v0 API credits |
| `v0_export_to_sandbox` | Fetch all files from a v0 chat and run them live in the E2B sandbox |

**Example WhatsApp commands:**
- *"Create a v0 chat: build a dashboard with dark mode and charts"*
- *"Send message to v0 chat abc123: add a sidebar navigation"*
- *"List my v0 chats"*
- *"Export my v0 chat to sandbox and run it"*
- *"Check my v0 rate limits"*

### MemOS — 3-Tier Memory System
- **Episodic** — Time-stamped events and session milestones (days → weeks)
- **Semantic** — Facts, preferences, and project knowledge (weeks → permanent)
- **Procedural** — Workflows, learned patterns, and behaviors (permanent)
- **Memory Graph** — Interactive visual graph of all memory nodes and relationships
- MongoDB-backed with full-text retrieval (RAG-lite) for context injection

### Intelligent Agent
- **No Guardrails** — Executes every tool immediately without confirmation prompts
- **Natural Language Understanding** — OpenAI GPT interprets casual, informal requests
- **Context Awareness** — Maintains conversation history for follow-up questions
- **Background Token Refresh** — Google access tokens auto-refreshed every 55 minutes
- **Direct Sandbox Fast-Path** — Sandbox commands bypass NLP for instant execution

---

## Architecture

### Component Breakdown

1. **Web Dashboard** (`public/`)
   - Landing page with animated background
   - Google OAuth register / sign-in pages
   - Real-time dashboard with Socket.IO
   - WhatsApp QR code linking
   - Cloud sandbox IDE with integrated terminal
   - Memory graph visualization
   - API key management

2. **OAuth Server** (`src/auth/oauth-server.ts`)
   - HTTP server serving static files and API routes
   - Google OAuth 2.0 flow with JWT token generation
   - Protected API endpoints for user settings, memory, and sandbox
   - Socket.IO for real-time WhatsApp session events

3. **WhatsApp Layer** (`src/whatsapp/`)
   - `session-manager.ts` — Multi-user session orchestrator; auto-links phone to Google account; persistent typing indicator during AI processing
   - `client.ts` — Baileys WebSocket client per user; deduplicates messages by tracking sent message IDs; handles QR generation and reconnect on disconnect
   - `mongo-auth-state.ts` — Replaces Baileys' default file-based auth with MongoDB-backed auth state stored in the `baileys_auth` collection; WhatsApp sessions survive server restarts without re-scanning QR

4. **Agent Core** (`src/agent/core.ts`)
   - Central orchestrator for message processing
   - Per-user tool registry with cached OAuth clients
   - Direct fast-path for E2B sandbox commands (no NLP round-trip)
   - Routes messages to NLP engine for all other requests

5. **NLP Engine** (`src/nlp/engine.ts`)
   - Integrates with OpenAI GPT
   - Parses user intent from natural language
   - Generates structured tool calls — executes immediately, no confirmation
   - Returns clarification only when a required parameter is missing

6. **User Manager** (`src/auth/user-manager.ts`)
   - MongoDB-backed user storage with phone-to-email linking
   - Google OAuth token management per user (file + DB dual sync)
   - Background token refresh worker (every 55 min)
   - AES-256-GCM encryption for API keys

7. **E2B Sandbox Manager** (`src/sandbox/e2b-manager.ts`)
   - Creates and manages per-user cloud Linux VMs via E2B
   - Auto-installs VS Code server (code-server) in each sandbox
   - Provides `runCommand`, `writeFile`, `readFile`, `listFiles` APIs
   - Keepalive timer prevents sandbox timeout
   - Auto-detects dead sandboxes and provisions fresh ones

8. **Memory Manager** (`src/memory/manager.ts` + `src/memory/memos-store.ts`)
   - **Short-term**: Last 10 conversation turns (in-memory)
   - **Working**: Current multi-step task state (30 min timeout)
   - **Long-term**: MongoDB — user profiles, preferences, history
   - **MemOS**: 3-tier episodic / semantic / procedural store with graph retrieval

9. **Tool Registry** (`src/tools/registry.ts`)
   - Per-user tool instances with isolated Google API clients
   - Gmail, Calendar, Drive, Sheets, Docs, Classroom tools
   - Sandbox tools (run command, write file, read file, list files)
   - v0 → Sandbox combined tool (fetch + write + run in one shot)
   - Optional Manus AI and v0 by Vercel tools

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Runtime** | Node.js 18+ |
| **Language** | TypeScript |
| **AI / NLP** | OpenAI GPT |
| **WhatsApp** | @whiskeysockets/baileys |
| **Google APIs** | googleapis (v144+) |
| **Cloud Sandbox** | E2B (@e2b/code-interpreter) |
| **Manus / v0 Skills** | openclaw (^2026.2.26) |
| **Database** | MongoDB (Atlas or local) |
| **Auth** | Google OAuth 2.0, JWT, AES-256-GCM, bcryptjs |
| **Real-time** | Socket.IO |
| **Logging** | pino |
| **Frontend** | Vanilla HTML / CSS / JS |
| **Build** | TypeScript Compiler (tsx) |
| **Deployment** | Docker + nginx, or PM2 |

---

## Prerequisites

Before you begin, ensure you have:

1. **Node.js** v18 or higher
   ```bash
   node --version
   ```

2. **MongoDB** — [MongoDB Atlas](https://www.mongodb.com/atlas) (free tier) or local MongoDB

3. **OpenAI API Key** — [platform.openai.com](https://platform.openai.com/)

4. **Google Cloud Project**
   - Create a project in [Google Cloud Console](https://console.cloud.google.com/)
   - Enable APIs: Gmail, Calendar, Drive, Sheets, Docs, Classroom
   - Create OAuth 2.0 credentials (Web application type)
   - Set redirect URI to `http://localhost:3000/oauth2callback`

5. **E2B API Key** *(optional — required for sandbox features)*
   - Sign up at [e2b.dev](https://e2b.dev/)

6. **WhatsApp Account** — A valid WhatsApp account on your phone

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/SAGARRAMBADE21/WHATSAPP_AI.git
cd WHATSAPP_AI
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file:

```env
# OpenAI
OPENAI_API_KEY=sk-proj-...your-key-here
OPENAI_MODEL=gpt-4o

# Google OAuth (Web Application type)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback

# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/workspace_navigator
MONGODB_DB_NAME=workspace_navigator

# Security
JWT_SECRET=your-random-jwt-secret-min-32-chars
ENCRYPTION_KEY=your-random-encryption-key-min-32-chars

# E2B Cloud Sandbox (optional)
E2B_API_KEY=your-e2b-api-key

# Optional
LOG_LEVEL=info
```

### 4. Run

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

The server starts at **http://localhost:3000**. Keep the terminal open — the server must stay running.

---

## Configuration

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. **Enable APIs**: Gmail, Google Calendar, Google Drive, Google Sheets, Google Docs, Google Classroom
4. **Create OAuth Credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Choose **Web application**
   - Add authorized redirect URI: `http://localhost:3000/oauth2callback`
   - Copy `client_id` and `client_secret` to `.env`
5. **OAuth Consent Screen**:
   - Add your email as a test user
   - Note: test app tokens expire in 7 days — publish the app for permanent tokens

### Google Token Refresh

Google access tokens auto-refresh every ~55 minutes via a background worker. If the refresh token itself expires (7-day limit for test apps), re-authenticate at `http://localhost:3000/login.html`. After re-auth via the web dashboard, the WhatsApp session picks up the new token immediately.

---

## Usage

### User Flow

1. Visit **http://localhost:3000** and click **Get Started**
2. **Register** with your Google account (Google OAuth)
3. On the **Dashboard**, scan the QR code with WhatsApp
4. Your WhatsApp is now linked to your Google Workspace
5. Send natural language messages on WhatsApp to manage your workspace
6. Optionally add **Manus AI** and **v0** API keys on the dashboard for advanced features
7. Click **Sandbox** to open the cloud Linux IDE

---

## Available Commands

### Natural Language (Just type naturally)

| Action | Example |
|--------|---------|
| Send email | "Send email to alice@example.com about project status" |
| Read email | "Show me the latest email from John" |
| Search emails | "Find emails about invoices from last week" |
| Schedule event | "Schedule a meeting tomorrow at 3 PM called Team Sync" |
| List events | "What are my meetings today?" |
| Find files | "Find all PDFs about budget in Drive" |
| Share file | "Share document xyz with alice@example.com" |
| Read sheet | "Read data from my expenses spreadsheet" |
| Create doc | "Create a document called Meeting Notes" |
| List courses | "List my Classroom courses" |

### E2B Sandbox Commands (WhatsApp)

| Format | Example |
|--------|---------|
| `E2B sandbox: <command>` | `E2B sandbox: ls /home/user` |
| `In E2B sandbox, run: <command>` | `In E2B sandbox, run: npm install` |
| `Run in E2B sandbox: <command>` | `Run in E2B sandbox: python3 hello.py` |

### Manus AI Commands (WhatsApp)

| Action | Example |
|--------|---------|
| Run cloud task | "Send to Manus: research the top 5 AI tools in 2025" |
| Hybrid local control | "Manus hybrid: open Notepad and type Hello World" |
| List tasks | "Show my recent Manus tasks" |
| View task output | "Get Manus task abc123" |
| Run shell command | "Manus exec: ipconfig" |
| Desktop screenshot | "Take a screenshot of my desktop" |
| System info | "Show my desktop system info" |

### v0 by Vercel Commands (WhatsApp)

| Action | Example |
|--------|---------|
| Generate UI | "Create v0 chat: a login page with Google sign-in button" |
| Iterate design | "Send message to v0 chat abc123: make the button orange" |
| List chats | "List my v0 chats" |
| Get code files | "Get files from v0 chat abc123" |
| Deploy to Vercel | "Deploy v0 project xyz" |
| Run in sandbox | "Export v0 chat abc123 to sandbox and start it" |
| Check credits | "Check my v0 rate limits" |

---

## Security

| Layer | Mechanism |
|-------|-----------|
| **Authentication** | Google OAuth 2.0 (no passwords stored) |
| **Sessions** | JWT tokens with 7-day expiry |
| **API Key Storage** | AES-256-GCM encryption at rest in MongoDB |
| **User Isolation** | Separate OAuth tokens, tool registries, memory, and sandbox per user |
| **Key Display** | Dashboard never exposes full API keys (masked) |
| **Token Sync** | Per-user token files + MongoDB dual-sync with background refresh |
| **Transport** | HTTPS recommended for production deployment |

---

## Project Structure

```
whatsapp_slack/
├── src/
│   ├── agent/
│   │   └── core.ts              # AI agent orchestrator (per-user tools + sandbox fast-path)
│   ├── auth/
│   │   ├── oauth-server.ts      # HTTP server, OAuth, API routes (memory + sandbox APIs)
│   │   ├── user-manager.ts      # User CRUD, token management, background refresh worker
│   │   └── crypto.ts            # AES-256-GCM encryption
│   ├── google/
│   │   └── auth.ts              # Google OAuth client with auto token refresh
│   ├── memory/
│   │   ├── manager.ts           # Memory orchestrator
│   │   ├── memos-store.ts       # MemOS 3-tier episodic/semantic/procedural store
│   │   ├── short-term.ts        # Recent conversation history
│   │   ├── working.ts           # Current task state
│   │   └── long-term.ts         # MongoDB persistent storage
│   ├── nlp/
│   │   └── engine.ts            # OpenAI GPT integration (no-guardrail mode)
│   ├── sandbox/
│   │   └── e2b-manager.ts       # E2B cloud VM manager (create, run, IDE, keepalive)
│   ├── tools/
│   │   ├── registry.ts          # Tool management
│   │   ├── gmail.ts             # Gmail operations
│   │   ├── calendar.ts          # Calendar operations
│   │   ├── drive.ts             # Drive operations
│   │   ├── sheets.ts            # Sheets operations
│   │   ├── docs.ts              # Docs operations
│   │   ├── classroom.ts         # Classroom operations
│   │   ├── sandbox.ts           # E2B sandbox tools (run, write, read, list)
│   │   ├── v0-sandbox.ts        # v0 → E2B combined export + run tool
│   │   ├── manus.ts             # Manus AI integration
│   │   └── v0.ts                # v0 by Vercel integration
│   ├── whatsapp/
│   │   ├── session-manager.ts   # Multi-user session orchestrator with typing indicators
│   │   ├── client.ts            # Baileys WebSocket client (QR, reconnect, dedup)
│   │   └── mongo-auth-state.ts  # MongoDB-backed Baileys auth state (no re-scan on restart)
│   ├── config.ts                # Configuration loader
│   ├── types.ts                 # TypeScript interfaces
│   └── index.ts                 # Application entry point
├── public/
│   ├── index.html               # Landing page
│   ├── register.html            # New user registration
│   ├── login.html               # Returning user sign-in
│   ├── dashboard.html           # Real-time user dashboard
│   ├── sandbox.html             # Cloud IDE + terminal + real-time file explorer
│   └── memory-graph.html        # Interactive MemOS memory graph
├── skills/
│   ├── manus-computer/          # Manus AI CLI scripts (run by openclaw)
│   └── v0skill/                 # v0 by Vercel CLI scripts (run by openclaw)
├── data/                        # Session data (gitignored)
├── dist/                        # Compiled JavaScript (gitignored)
├── logs/                        # PM2 log output (gitignored)
├── dns-preload.js               # DNS pre-resolution fix for MongoDB Atlas SRV lookups
├── Dockerfile                   # Container build (Node 18 slim, non-root user)
├── docker-compose.yml           # Docker Compose with env_file wiring
├── ecosystem.config.js          # PM2 config (single instance, 500M limit, log rotation)
├── nginx.conf                   # Production nginx reverse proxy (TLS, rate-limit, WebSocket)
├── .env                         # Environment variables (gitignored)
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

---

## How It Works

### Message Flow

```
User sends WhatsApp message
  → Session Manager receives message (typing indicator starts)
  → Sandbox command? → Fast-path execution (no NLP round-trip)
  → Otherwise: Agent Core loads per-user tool registry
  → NLP Engine (OpenAI) interprets intent → tool call JSON
  → Tool executed with user's Google OAuth tokens / E2B sandbox
  → Response sent back to WhatsApp (typing indicator stops)
```

### Memory Flow

```
Every AI response
  → MemOS stores episodic event (what happened)
  → Relevant past memories retrieved (RAG-lite)
  → Injected into system prompt as context
  → Memory Graph updated in real-time
```

### Token Refresh Flow

```
Background worker runs every 55 minutes
  → Finds all tokens expiring within 5 minutes
  → Calls Google refreshAccessToken()
  → Saves new access token to file + MongoDB
  → WhatsApp bot picks up fresh token on next request
```

### DNS Pre-load

`dns-preload.js` is required before the main entry point (`node --require ./dns-preload.js`). It resolves MongoDB Atlas SRV hostnames at startup, avoiding DNS lookup failures that occur when Node.js resolves SRV records lazily after the event loop is busy.

### Memory System

| Type | Storage | Duration | Purpose |
|------|---------|----------|---------|
| **Short-term** | In-memory | Last 10 turns | Follow-up context |
| **Working** | In-memory | 30 min timeout | Multi-step task state |
| **Long-term** | MongoDB | Persistent | User profiles, preferences, history |
| **MemOS Episodic** | MongoDB | Days → weeks | What happened, when |
| **MemOS Semantic** | MongoDB | Permanent | Facts, preferences, project knowledge |
| **MemOS Procedural** | MongoDB | Permanent | Workflows, learned patterns |

---

## Deployment

### PM2 (recommended for VPS)

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
```

PM2 runs a single instance (required — WhatsApp sessions are not multi-instance safe), auto-restarts on crash, and caps memory at 500 MB. Logs go to `./logs/`.

### Docker + nginx

```bash
# Build and start the container
docker-compose up -d

# Then configure nginx as a reverse proxy
# Edit nginx.conf: replace yourdomain.com with your domain
sudo cp nginx.conf /etc/nginx/sites-available/workspace-navigator
sudo ln -s /etc/nginx/sites-available/workspace-navigator /etc/nginx/sites-enabled/
sudo certbot --nginx -d yourdomain.com   # free TLS via Let's Encrypt
sudo nginx -t && sudo systemctl reload nginx
```

nginx handles: TLS termination, HTTP→HTTPS redirect, WebSocket upgrade (required for Socket.IO QR code), rate limiting (50 req/s per IP, burst 100), and security headers.

### Development

```bash
npm run dev          # tsx hot-reload, no build step
npm run dev:watch    # nodemon wrapper for auto-restart on file changes
```

---

## License

MIT

---

Made by [Sagar Rambade](https://github.com/SAGARRAMBADE21)
