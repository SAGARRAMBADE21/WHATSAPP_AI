# Workspace Navigator

**AI-Powered Google Workspace Assistant via WhatsApp**

Control your entire Google Workspace (Gmail, Calendar, Drive, Sheets, Docs, Classroom) through natural language WhatsApp messages. Workspace Navigator is a multi-user AI agent with secure Google OAuth login, per-user isolation, and a real-time web dashboard.

![Workspace Navigator](./doc/whatsapp-slack.png)

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
- **Google OAuth Login** - Secure sign-in via Google (no passwords stored)
- **Separate Register & Sign In** pages for new and returning users
- **Per-User Isolation** - Each user gets their own Google tokens, WhatsApp session, tools, and memory
- **Real-time Dashboard** - Live connection status, activity feed, and API key management
- **JWT Sessions** - 7-day token expiry with automatic renewal

### Gmail Management
- Send emails with natural language commands
- Create and manage drafts
- Search emails using Gmail search syntax
- Read email content
- Delete/archive messages
- Add labels and organize inbox

### Calendar Operations
- Create events with smart date parsing
- List upcoming events
- Update existing events
- Delete events
- Handle recurring events

### Google Drive
- Search for files
- Share files with specific people
- List folder contents
- Create folders
- Delete files

### Google Sheets
- Read data from spreadsheets
- Write data to cells or ranges
- Update individual cells
- Append new rows

### Google Docs
- Create new documents
- Read document content
- Append text to documents

### Google Classroom
- List courses
- View assignments
- Post announcements

### Advanced AI Tools
- **Manus AI** - Cloud tasks, autonomous agents, desktop control (requires API key)
- **v0 by Vercel** - AI-powered UI generation, project management, deployment (requires API key)
- Per-user API keys stored with AES-256-GCM encryption

### Intelligent Features
- **Natural Language Understanding**: Uses OpenAI GPT to interpret casual requests
- **Context Awareness**: Maintains conversation history for follow-up questions
- **Memory System**: Short-term, working, and long-term memory (MongoDB-backed)
- **Smart Clarification**: Asks for details when requests are ambiguous
- **Error Recovery**: Graceful error handling with user-friendly messages

---

## Architecture

### Component Breakdown

1. **Web Dashboard** (`public/`)
   - Landing page with 3D Spline background
   - Google OAuth register/sign-in pages
   - Real-time dashboard with Socket.IO
   - WhatsApp QR code linking
   - API key management

2. **OAuth Server** (`src/auth/oauth-server.ts`)
   - HTTP server serving static files and API routes
   - Google OAuth 2.0 flow with JWT token generation
   - Protected API endpoints for user settings
   - Socket.IO for real-time WhatsApp session management

3. **Session Manager** (`src/whatsapp/session-manager.ts`)
   - Multi-user WhatsApp session handling
   - Auto-links phone numbers to Google accounts
   - Session persistence and restoration via MongoDB
   - Automatic reconnection on disconnects

4. **Agent Core** (`src/agent/core.ts`)
   - Central orchestrator for message processing
   - Per-user tool registry with cached OAuth clients
   - Routes messages to NLP engine
   - Executes tool calls with user-specific credentials

5. **NLP Engine** (`src/nlp/engine.ts`)
   - Integrates with OpenAI GPT
   - Parses user intent from natural language
   - Generates structured tool calls
   - Returns clarification requests when needed

6. **User Manager** (`src/auth/user-manager.ts`)
   - MongoDB-backed user storage
   - Google OAuth token management per user
   - API key encryption/decryption (AES-256-GCM)
   - Phone-to-email linking

7. **Memory Manager** (`src/memory/manager.ts`)
   - **Short-term**: Last 10 conversation turns
   - **Working**: Current multi-step task state
   - **Long-term**: MongoDB database for user profiles, preferences, and history

8. **Tool Registry** (`src/tools/registry.ts`)
   - Per-user tool instances with isolated Google API clients
   - Gmail, Calendar, Drive, Sheets, Docs, Classroom tools
   - Optional Manus AI and v0 by Vercel tools

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Runtime** | Node.js 18+ |
| **Language** | TypeScript |
| **AI/NLP** | OpenAI GPT |
| **WhatsApp** | @whiskeysockets/baileys |
| **Google APIs** | googleapis (v144+) |
| **Database** | MongoDB (Atlas or local) |
| **Auth** | Google OAuth 2.0, JWT, AES-256-GCM |
| **Real-time** | Socket.IO |
| **Frontend** | Vanilla HTML/CSS/JS, Spline 3D |
| **Build** | TypeScript Compiler |
| **Dev Tools** | ts-node, nodemon |

---

## Prerequisites

Before you begin, ensure you have:

1. **Node.js** (v18 or higher)
   ```bash
   node --version
   ```

2. **Python** 3.8+ (for Manus AI tools, optional)
   ```bash
   python --version
   ```

3. **MongoDB** - [MongoDB Atlas](https://www.mongodb.com/atlas) (free tier) or local MongoDB

4. **OpenAI API Key** - Sign up at [OpenAI](https://platform.openai.com/)

5. **Google Cloud Project**
   - Create a project in [Google Cloud Console](https://console.cloud.google.com/)
   - Enable APIs: Gmail, Calendar, Drive, Sheets, Docs, Classroom
   - Create OAuth 2.0 credentials (Web application)
   - Set redirect URI to `http://localhost:3000/oauth2callback`

6. **WhatsApp Account** - A valid WhatsApp account on your phone

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

# Optional
LOG_LEVEL=info
```

### 4. Build and Run

```bash
npm run build
npm start
```

The server starts at **http://localhost:3000**.

---

## Configuration

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. **Enable APIs**:
   - Gmail API
   - Google Calendar API
   - Google Drive API
   - Google Sheets API
   - Google Docs API
   - Google Classroom API
4. **Create OAuth Credentials**:
   - Navigate to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose **"Web application"**
   - Add authorized redirect URI: `http://localhost:3000/oauth2callback`
   - Copy `client_id` and `client_secret` to `.env`
5. **Configure OAuth Consent Screen**:
   - Add your email as a test user
   - Add required scopes (the app requests these automatically)

---

## Usage

### User Flow

1. Visit **http://localhost:3000** and click **Get Started**
2. **Register** with your Google account (Google OAuth)
3. On the **Dashboard**, scan the QR code with WhatsApp
4. Your WhatsApp is now linked to your Google Workspace
5. Send natural language messages on WhatsApp to manage your workspace
6. Optionally add **Manus AI** and **v0** API keys on the dashboard for advanced features

### Running the App

**Production Mode**:
```bash
npm run build
npm start
```

**Development Mode** (with hot reload):
```bash
npm run dev
```

**Development Mode** (with auto-restart):
```bash
npm run dev:watch
```

---

## Available Commands

### Natural Language (Just type naturally)

| Action | Example |
|--------|---------|
| Send email | "Send email to alice@example.com about project status" |
| Create draft | "Draft an email to bob saying I'll be late" |
| Search emails | "Find emails from john about invoices" |
| Schedule event | "Schedule meeting tomorrow at 3 PM with Team Sync" |
| List events | "What are my meetings today?" |
| Find files | "Find all PDFs about budget in Drive" |
| Share file | "Share document xyz with alice@example.com" |
| Read sheet | "Read data from my expenses spreadsheet" |
| Create doc | "Create a document called Meeting Notes" |
| List courses | "List my Classroom courses" |

### Special Commands

| Command | Description |
|---------|-------------|
| `/status` | Check your connection status and account info |
| `/logout` | Disconnect and delete all stored data |

---

## Security

| Layer | Mechanism |
|-------|-----------|
| **Authentication** | Google OAuth 2.0 (no passwords stored) |
| **Sessions** | JWT tokens with 7-day expiry |
| **API Key Storage** | AES-256-GCM encryption at rest in MongoDB |
| **User Isolation** | Separate OAuth tokens, tool registries, and memory per user |
| **Key Display** | Dashboard never exposes full API keys (masked with last 4 chars) |
| **Token Security** | Per-user token files + MongoDB backup with refresh sync |
| **Transport** | HTTPS recommended for production deployment |

### Per-User Isolation

Each user has completely isolated:
- Google OAuth2 client and tokens
- WhatsApp session
- Tool registry (Gmail, Calendar, Drive, etc.)
- Conversation memory and history
- Manus AI and v0 API keys

User A cannot access User B's data at any layer.

---

## Project Structure

```
whatsapp_slack/
├── src/
│   ├── agent/
│   │   └── core.ts              # AI agent orchestrator (per-user tools)
│   ├── auth/
│   │   ├── oauth-server.ts      # HTTP server, OAuth, API routes
│   │   ├── user-manager.ts      # User CRUD, token management
│   │   └── crypto.ts            # AES-256-GCM encryption
│   ├── google/
│   │   └── auth.ts              # Google OAuth client manager
│   ├── memory/
│   │   ├── manager.ts           # Memory orchestrator
│   │   ├── short-term.ts        # Recent conversation history
│   │   ├── working.ts           # Current task state
│   │   └── long-term.ts         # MongoDB persistent storage
│   ├── nlp/
│   │   └── engine.ts            # OpenAI GPT integration
│   ├── tools/
│   │   ├── registry.ts          # Tool management
│   │   ├── gmail.ts             # Gmail operations
│   │   ├── calendar.ts          # Calendar operations
│   │   ├── drive.ts             # Drive operations
│   │   ├── sheets.ts            # Sheets operations
│   │   ├── docs.ts              # Docs operations
│   │   ├── classroom.ts         # Classroom operations
│   │   ├── manus.ts             # Manus AI integration
│   │   └── v0.ts                # v0 by Vercel integration
│   ├── whatsapp/
│   │   ├── client.ts            # WhatsApp connection (standalone)
│   │   └── session-manager.ts   # Multi-user session manager
│   ├── config.ts                # Configuration loader
│   ├── types.ts                 # TypeScript interfaces
│   └── index.ts                 # Application entry point
├── public/
│   ├── index.html               # Landing page (Spline 3D)
│   ├── register.html            # New user registration
│   ├── login.html               # Returning user sign-in
│   └── dashboard.html           # Real-time user dashboard
├── skills/
│   ├── manus-computer/          # Manus AI CLI scripts
│   └── v0skill/                 # v0 by Vercel CLI scripts
├── data/                        # Session data (gitignored)
├── dist/                        # Compiled JavaScript (gitignored)
├── dns-preload.js               # DNS fix for MongoDB Atlas SRV
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
  → Session Manager receives message
  → Auto-links phone to Google account (if needed)
  → Agent Core loads per-user tool registry
  → NLP Engine (OpenAI) interprets intent
  → Tool executed with user's Google OAuth tokens
  → Response sent back to WhatsApp
```

### Detailed Flow

1. **User sends WhatsApp message**
   ```
   "Send email to alice@example.com about the report"
   ```

2. **Session Manager** receives the message, identifies the user by phone number, and routes to the AI agent

3. **Agent Core** loads the user's specific tool registry with their Google OAuth credentials

4. **NLP Engine** sends the message to OpenAI with conversation history and available tools, receiving a structured tool call:
   ```json
   {
     "tool_name": "gmail_send_email",
     "parameters": {
       "to": "alice@example.com",
       "subject": "Report",
       "body": "Here is the report you requested..."
     }
   }
   ```

5. **Tool Registry** finds `gmail_send_email`, executes it using the user's authenticated Google API client

6. **Agent responds** with a formatted message sent back to WhatsApp:
   ```
   Email sent successfully to alice@example.com
   Subject: "Report"
   ```

### Memory System

| Type | Storage | Duration | Purpose |
|------|---------|----------|---------|
| **Short-term** | In-memory | Last 10 turns | Follow-up context ("Send it to Bob too") |
| **Working** | In-memory | 30 min timeout | Multi-step task state |
| **Long-term** | MongoDB | Persistent | User profiles, preferences, history |

---

## Deployment

### Docker

```bash
docker-compose up -d
```

### PM2 (Production)

```bash
npm run build
pm2 start dist/index.js --name workspace-navigator -- --require ./dns-preload.js
```

See `docker-compose.yml` and `doc/` for detailed deployment guides.

---

## License

MIT

---

Made by [Sagar Rambade](https://github.com/SAGARRAMBADE21)
