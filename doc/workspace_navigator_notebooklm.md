# Workspace Navigator

## What Is It
An AI-powered assistant that lets you control your entire Google Workspace through WhatsApp messages using natural language.

## How It Works
1. User sends a WhatsApp message like "Find last month's sales report in Drive, share it with rahul@company.com, and email him saying the Q4 numbers are ready for review"
2. AI (OpenAI GPT-5.1) understands the intent and breaks it into steps
3. Searches Drive, shares the file, and sends the email — all in one go
4. Sends confirmation reply back in WhatsApp

## 6 Google Services Supported
- Gmail — Send emails, manage drafts, search inbox, manage labels and filters
- Calendar — Create/update/delete events, check availability, manage calendars
- Drive — Search, upload, share, copy, move, rename, and delete files
- Sheets — Read, write, format, sort, and manage spreadsheet data
- Docs — Create, edit, format text, insert images, tables, and lists
- Classroom — Manage courses, assignments, grading, announcements, and students

## 80+ Total Operations
- Gmail: 14 operations
- Calendar: 10 operations
- Drive: 15 operations
- Sheets: 13 operations
- Docs: 13 operations
- Classroom: 16 operations

## Architecture
- WhatsApp Client — Handles messaging via Baileys library
- Agent Core — Central orchestrator connecting all components
- NLP Engine — GPT-5.1 for intent parsing and tool calling
- Memory Manager — 3-layer memory system
- Tool Registry — 80+ Google API operations
- Web Dashboard — Spline 3D interactive frontend

## Memory System
- Short-term: Last 10 conversation turns for follow-up context
- Working: Current task state for multi-step operations
- Long-term: MongoDB for user profiles, preferences, and history

## Tech Stack
- TypeScript, Node.js
- OpenAI GPT-5.1
- Google APIs (googleapis)
- WhatsApp (Baileys)
- MongoDB
- Spline 3D
- Socket.IO
- Google OAuth 2.0


