import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { Db } from 'mongodb';
import { Server as SocketIOServer, Socket } from 'socket.io';
import pino from 'pino';
import chalk from 'chalk';
import QRCode from 'qrcode';
import { useMongoDBAuthState } from './mongo-auth-state';
import { AgentCore } from '../agent/core';
import { NLPEngine } from '../nlp/engine';
import { ToolRegistry } from '../tools/registry';
import { MemoryManager } from '../memory/manager';
import { UserManager } from '../auth/user-manager';

interface SessionInfo {
    sessionId: string;
    socket: any;
    status: 'connecting' | 'connected' | 'disconnected';
    phoneNumber?: string;
    connectedAt?: Date;
}

interface SessionDoc {
    sessionId: string;
    phoneNumber?: string;
    status: string;
    createdAt: Date;
    lastActive: Date;
    googleConnected: boolean;
}

export class SessionManager {
    private sessions: Map<string, SessionInfo> = new Map();
    private db: Db;
    private io: SocketIOServer;
    private userManager: UserManager;
    private nlpEngine: NLPEngine;
    private memoryManager: MemoryManager;
    private sessionCollection;
    private decryptErrorCounts: Map<string, number> = new Map();
    private static readonly MAX_DECRYPT_ERRORS = 5;

    constructor(
        db: Db,
        io: SocketIOServer,
        userManager: UserManager,
        nlpEngine: NLPEngine,
        memoryManager: MemoryManager
    ) {
        this.db = db;
        this.io = io;
        this.userManager = userManager;
        this.nlpEngine = nlpEngine;
        this.memoryManager = memoryManager;
        this.sessionCollection = db.collection<SessionDoc>('sessions');

        this.setupSocketHandlers();
    }

    private setupSocketHandlers() {
        this.io.on('connection', (socket: Socket) => {
            console.log(chalk.cyan(`[Socket] Client connected: ${socket.id}`));

            socket.on('create-session', async (data: { sessionId?: string }) => {
                try {
                    const sessionId = data?.sessionId || this.generateSessionId();
                    console.log(chalk.yellow(`[Session] Creating session: ${sessionId}`));
                    socket.emit('session-status', { status: 'initializing', sessionId });
                    await this.createSession(sessionId, socket);
                } catch (error: any) {
                    console.error(chalk.red('[Session] Error creating session:'), error.message);
                    socket.emit('session-error', { error: error.message });
                }
            });

            socket.on('restore-session', async (data: { sessionId: string }) => {
                try {
                    console.log(chalk.yellow(`[Session] Restoring session: ${data.sessionId}`));
                    socket.emit('session-status', { status: 'restoring', sessionId: data.sessionId });
                    await this.createSession(data.sessionId, socket);
                } catch (error: any) {
                    console.error(chalk.red('[Session] Error restoring session:'), error.message);
                    socket.emit('session-error', { error: error.message });
                }
            });

            socket.on('disconnect', () => {
                console.log(chalk.gray(`[Socket] Client disconnected: ${socket.id}`));
            });
        });
    }

    private generateSessionId(): string {
        return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }

    async createSession(sessionId: string, clientSocket: Socket): Promise<void> {
        // If session already exists and connected, just notify
        const existing = this.sessions.get(sessionId);
        if (existing && existing.status === 'connected') {
            clientSocket.emit('session-status', {
                status: 'connected',
                sessionId,
                phoneNumber: existing.phoneNumber,
            });
            return;
        }

        const logger = pino({ level: 'silent' });
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds, deleteSession } = await useMongoDBAuthState(this.db, sessionId);

        const sock = makeWASocket({
            version,
            logger,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            connectTimeoutMs: 60_000,
            retryRequestDelayMs: 250,
            defaultQueryTimeoutMs: 0,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
        });

        // Reset decrypt error count for this session
        this.decryptErrorCounts.set(sessionId, 0);

        // Store session
        this.sessions.set(sessionId, {
            sessionId,
            socket: sock,
            status: 'connecting',
        });

        // ── Handle QR Code ──
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(chalk.cyan(`[Session ${sessionId}] QR code generated`));
                try {
                    const qrDataUrl = await QRCode.toDataURL(qr, {
                        width: 260,
                        margin: 2,
                        color: { dark: '#0a0a0a', light: '#ffffff' },
                        errorCorrectionLevel: 'M',
                    });
                    clientSocket.emit('qr-code', { qr: qrDataUrl, sessionId });
                } catch (qrErr) {
                    console.error(chalk.red('QR generation error:'), qrErr);
                }
            }

            if (connection === 'open') {
                const phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || '';
                console.log(chalk.green(`[Session ${sessionId}] Connected! Phone: ${phoneNumber}`));

                this.sessions.set(sessionId, {
                    sessionId,
                    socket: sock,
                    status: 'connected',
                    phoneNumber,
                    connectedAt: new Date(),
                });

                // Save session to MongoDB
                await this.sessionCollection.updateOne(
                    { sessionId },
                    {
                        $set: {
                            sessionId,
                            phoneNumber,
                            status: 'connected',
                            lastActive: new Date(),
                            googleConnected: false,
                        },
                        $setOnInsert: { createdAt: new Date() },
                    },
                    { upsert: true }
                );

                clientSocket.emit('session-status', {
                    status: 'connected',
                    sessionId,
                    phoneNumber,
                });

                // Setup message handler and error handler for this session
                this.setupMessageHandler(sessionId, sock);
                this.setupDecryptionErrorHandler(sessionId, sock);
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const errorMessage = (lastDisconnect?.error as Boom)?.message || 'Unknown';
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(chalk.yellow(`[Session ${sessionId}] Disconnected. Code: ${statusCode} (${errorMessage})`));

                if (statusCode === DisconnectReason.loggedOut) {
                    // User logged out — clean up
                    console.log(chalk.red(`[Session ${sessionId}] Logged out. Removing session.`));
                    await deleteSession();
                    this.sessions.delete(sessionId);
                    this.decryptErrorCounts.delete(sessionId);
                    await this.sessionCollection.updateOne(
                        { sessionId },
                        { $set: { status: 'logged_out' } }
                    );
                    clientSocket.emit('session-status', { status: 'logged_out', sessionId });
                } else if (statusCode === 440 || statusCode === 428) {
                    // Connection replaced by another device/session
                    console.log(chalk.yellow(`[Session ${sessionId}] Connection replaced. Clearing session and reconnecting...`));
                    await deleteSession();
                    this.sessions.delete(sessionId);
                    this.decryptErrorCounts.delete(sessionId);
                    clientSocket.emit('session-status', { status: 'reconnecting', sessionId });
                    setTimeout(() => this.createSession(sessionId, clientSocket), 5000);
                } else if (shouldReconnect) {
                    // Try to reconnect
                    console.log(chalk.yellow(`[Session ${sessionId}] Reconnecting...`));
                    clientSocket.emit('session-status', { status: 'reconnecting', sessionId });
                    setTimeout(() => this.createSession(sessionId, clientSocket), 3000);
                }
            }
        });

        // Save credentials on update
        sock.ev.on('creds.update', saveCreds);
    }

    private setupMessageHandler(sessionId: string, sock: any) {
        // Track message IDs sent by the bot to prevent feedback loops
        const botSentMessageIds = new Set<string>();
        // Track processed message IDs to prevent duplicates
        const processedMessageIds = new Set<string>();

        // Wrap sock.sendMessage to track bot's own messages
        const originalSendMessage = sock.sendMessage.bind(sock);
        sock.sendMessage = async (...args: any[]) => {
            const result = await originalSendMessage(...args);
            if (result?.key?.id) {
                botSentMessageIds.add(result.key.id);
                // Clean up old IDs after 5 minutes to prevent memory leak
                setTimeout(() => botSentMessageIds.delete(result.key.id), 5 * 60 * 1000);
            }
            return result;
        };

        sock.ev.on('messages.upsert', async (m: any) => {
            // Only process 'notify' type (real messages, not history sync)
            if (m.type !== 'notify') return;

            const msg = m.messages?.[0];
            if (!msg || !msg.message) return;

            // Skip messages sent by the bot itself (prevents feedback loop)
            if (msg.key.id && botSentMessageIds.has(msg.key.id)) {
                return;
            }

            // Skip already-processed messages (prevents duplicates)
            if (msg.key.id && processedMessageIds.has(msg.key.id)) {
                return;
            }
            if (msg.key.id) {
                processedMessageIds.add(msg.key.id);
                // Clean up old IDs after 5 minutes
                setTimeout(() => processedMessageIds.delete(msg.key.id), 5 * 60 * 1000);
            }

            const senderJid = msg.key.remoteJid;
            if (!senderJid) return;

            // Skip status broadcasts
            if (senderJid === 'status@broadcast') return;
            // Skip newsletter/channel messages
            if (senderJid.includes('@newsletter')) return;

            // Extract text
            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                '';

            if (!text.trim()) return;

            // For multi-session: this is the USER's own WhatsApp
            const userNumber = sock.user?.id?.split(':')[0] || senderJid.replace('@s.whatsapp.net', '');
            const isSelfChat = senderJid.endsWith('@lid');
            const isCommand = text.startsWith('/');

            // Process: self-chat messages, fromMe, commands, or messages from others
            if (!msg.key.fromMe && !isSelfChat && !isCommand) {
                // Skip non-command messages from other people (privacy)
                return;
            }

            console.log(chalk.blue(`[Session ${sessionId}] ${msg.key.fromMe ? 'Self' : 'Incoming'}: "${text.substring(0, 50)}"`));

            // CRITICAL: @lid JIDs don't receive messages!
            // Convert to proper @s.whatsapp.net using the session's phone number
            let replyJid: string;
            if (isSelfChat) {
                replyJid = `${userNumber}@s.whatsapp.net`;
            } else {
                replyJid = senderJid;
            }
            console.log(chalk.gray(`[Session ${sessionId}] senderJid: ${senderJid} → replyJid: ${replyJid}`));

            // Get session info
            const session = this.sessions.get(sessionId);
            if (!session) return;

            try {
                // Check if user is registered using UserManager (source of truth)
                const isRegistered = await this.userManager.isUserRegistered(userNumber);
                console.log(chalk.gray(`[Session ${sessionId}] User ${userNumber} registered: ${isRegistered}`));

                // Keep session doc in sync with actual registration status
                if (isRegistered) {
                    await this.sessionCollection.updateOne(
                        { sessionId },
                        { $set: { googleConnected: true, lastActive: new Date() } }
                    );
                }

                if (text.toLowerCase().startsWith('/register')) {
                    if (isRegistered) {
                        await sock.sendMessage(replyJid, {
                            text: '✅ You\'re already registered! Your Google Workspace is connected.\n\nSend any message to get started, or /status to see your info.',
                        });
                        return;
                    }
                    // Start registration with the REAL phone number
                    const userPhoneNumber = userNumber;
                    console.log(chalk.yellow(`[Session ${sessionId}] Starting registration for phone: ${userPhoneNumber}`));
                    await this.userManager.startRegistration(userPhoneNumber);

                    // Generate short redirect URL using phone number (not session ID!)
                    const shortAuthUrl = `http://localhost:3000/auth/start?session=${userPhoneNumber}`;
                    console.log(chalk.yellow(`[Session ${sessionId}] Sending short auth URL...`));
                    await sock.sendMessage(replyJid, {
                        text: `🔐 *Connect Google Workspace*\n\nClick this link to connect your Google account:\n${shortAuthUrl}\n\n⏱️ Link expires in 15 minutes.`,
                    });
                    console.log(chalk.green(`[Session ${sessionId}] Auth URL sent!`));
                    return;
                }

                if (text.toLowerCase().startsWith('/status')) {
                    const user = await this.userManager.getUser(userNumber);
                    await sock.sendMessage(replyJid, {
                        text: `📊 *Session Status*\n\n🆔 Session: ${sessionId}\n📱 Phone: ${session.phoneNumber || 'N/A'}\n🔗 Google: ${isRegistered ? '✅ Connected' : '❌ Not connected'}${isRegistered && user ? `\n📧 Email: ${user.email || 'N/A'}\n👤 Name: ${user.name || 'N/A'}` : ''}\n\n${isRegistered ? 'You\'re all set! Send any message to manage your workspace.' : 'Send /register to connect Google Workspace.'}`,
                    });
                    return;
                }

                // For any other message, send welcome if NOT registered
                if (!isRegistered) {
                    console.log(chalk.yellow(`[Session ${sessionId}] User not registered, sending welcome...`));
                    await sock.sendMessage(replyJid, {
                        text: '👋 Welcome to Workspace Navigator!\n\n🔗 First, connect your Google account:\n📝 Send: /register\n\nOnce connected, you can manage Gmail, Calendar, Drive, Sheets, Docs — all from here!',
                    });
                    console.log(chalk.green(`[Session ${sessionId}] Welcome message sent!`));
                    return;
                }
            } catch (sendError: any) {
                console.error(chalk.red(`[Session ${sessionId}] SEND ERROR: ${sendError.message}`));
                console.error(chalk.red(`[Session ${sessionId}] Stack: ${sendError.stack}`));
            }

            // Process with AI agent
            try {
                const toolRegistry = new ToolRegistry();
                // AgentCore.handleMessage() internally loads user-specific tools
                // via getUserToolRegistry() with proper OAuth2Client authentication
                const agent = new AgentCore(this.nlpEngine, toolRegistry, this.memoryManager, this.userManager);
                const incomingMessage = {
                    senderId: userNumber,
                    senderName: userNumber,
                    text,
                    timestamp: new Date(),
                    messageId: msg.key.id || '',
                    isGroup: senderJid.includes('@g.us'),
                };
                console.log(chalk.cyan(`[Session ${sessionId}] Processing with AI agent...`));
                const response = await agent.handleMessage(incomingMessage, userNumber);
                console.log(chalk.green(`[Session ${sessionId}] Agent responded, sending to ${replyJid}`));
                await sock.sendMessage(replyJid, { text: response });
                console.log(chalk.green(`[Session ${sessionId}] Response sent!`));
            } catch (error: any) {
                console.error(chalk.red(`[Session ${sessionId}] Error processing message:`), error.message);
                await sock.sendMessage(replyJid, {
                    text: '❌ Sorry, something went wrong processing your request. Please try again.',
                });
            }
        });
    }

    private setupDecryptionErrorHandler(sessionId: string, sock: any) {
        // Baileys emits error events when it fails to decrypt messages
        // We catch these to prevent noisy logs and auto-heal corrupted sessions
        const origEmit = sock.ev.emit.bind(sock.ev);
        sock.ev.emit = (event: string, ...args: any[]) => {
            // Let all events pass through normally
            return origEmit(event, ...args);
        };

        // Listen for messages.upsert errors by wrapping the handler
        // The actual PreKeyError/SessionError comes from Signal protocol decryption
        // and is logged by pino — we've silenced that with level: 'silent'.
        // Here we add a process-level handler to catch any uncaught errors from Baileys
        const handleDecryptError = async (error: Error) => {
            const errName = error?.name || '';
            const errMsg = error?.message || '';

            const isDecryptError =
                errName === 'PreKeyError' ||
                errName === 'SessionError' ||
                errMsg.includes('Invalid PreKey ID') ||
                errMsg.includes('failed to decrypt') ||
                errMsg.includes('No matching sessions');

            if (!isDecryptError) return; // Not our error, let it propagate

            const count = (this.decryptErrorCounts.get(sessionId) || 0) + 1;
            this.decryptErrorCounts.set(sessionId, count);

            console.log(chalk.gray(`[Session ${sessionId}] Decryption error #${count} (${errName}): ${errMsg.substring(0, 80)} — this is normal for first sync`));

            if (count >= SessionManager.MAX_DECRYPT_ERRORS) {
                console.log(chalk.yellow(`[Session ${sessionId}] Too many decryption errors (${count}). Clearing corrupted pre-keys...`));
                await this.clearCorruptedPreKeys(sessionId);
                this.decryptErrorCounts.set(sessionId, 0);
                console.log(chalk.green(`[Session ${sessionId}] Pre-keys cleared. Session will self-heal on next messages.`));
            }
        };

        // Baileys internally catches most of these, but in case they bubble up:
        process.on('unhandledRejection', (reason: any) => {
            if (reason instanceof Error) {
                handleDecryptError(reason).catch(() => { });
            }
        });
    }

    private async clearCorruptedPreKeys(sessionId: string) {
        const authCollection = this.db.collection('baileys_auth');

        // Remove pre-key, sender-key, and session related keys that may be corrupted
        const result = await authCollection.deleteMany({
            sessionId,
            key: {
                $regex: /^(pre-key-|sender-key-|session-|sender-key-memory-|app-state-sync-version-)/
            }
        });

        console.log(chalk.cyan(`[Session ${sessionId}] Cleared ${result.deletedCount} corrupted signal keys from MongoDB`));
    }

    // Restore all active sessions on server restart
    async restoreActiveSessions(): Promise<number> {
        const activeSessions = await this.sessionCollection
            .find({ status: 'connected' })
            .toArray();

        console.log(chalk.cyan(`[SessionManager] Found ${activeSessions.length} sessions to restore`));

        let restored = 0;
        for (const session of activeSessions) {
            try {
                // Create a dummy socket for background sessions
                const dummySocket = {
                    emit: () => { },
                    id: `restore_${session.sessionId}`,
                } as any;
                await this.createSession(session.sessionId, dummySocket);
                restored++;
            } catch (error: any) {
                console.error(chalk.red(`[SessionManager] Failed to restore ${session.sessionId}:`), error.message);
            }
        }

        return restored;
    }

    getActiveSessionCount(): number {
        let count = 0;
        this.sessions.forEach((s) => {
            if (s.status === 'connected') count++;
        });
        return count;
    }

    async getSessionStats() {
        const total = await this.sessionCollection.countDocuments();
        const connected = this.getActiveSessionCount();
        const googleConnected = await this.sessionCollection.countDocuments({ googleConnected: true });
        return { total, connected, googleConnected };
    }
}
