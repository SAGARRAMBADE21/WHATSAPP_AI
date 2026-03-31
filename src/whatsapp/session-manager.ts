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
import { E2BSandboxManager } from '../sandbox/e2b-manager';

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
    private sandboxManager: E2BSandboxManager;
    private sessionCollection;
    private decryptErrorCounts: Map<string, number> = new Map();
    private static readonly MAX_DECRYPT_ERRORS = 5;

    constructor(
        db: Db,
        io: SocketIOServer,
        userManager: UserManager,
        nlpEngine: NLPEngine,
        memoryManager: MemoryManager,
        sandboxManager: E2BSandboxManager
    ) {
        this.db = db;
        this.io = io;
        this.userManager = userManager;
        this.nlpEngine = nlpEngine;
        this.memoryManager = memoryManager;
        this.sandboxManager = sandboxManager;
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

                // Link the phone number to the user's email account
                // (sessionId is the user's email passed from the frontend JWT)
                if (phoneNumber && sessionId.includes('@')) {
                    const linked = await this.userManager.linkPhoneNumberToEmail(sessionId, phoneNumber);
                    if (linked) {
                        console.log(chalk.green(`[Session ${sessionId}] Linked WhatsApp phone ${phoneNumber} to account ${sessionId}`));
                    }
                }

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

            // Skip non-command messages from other people (privacy)
            if (!msg.key.fromMe && !isSelfChat && !isCommand) {
                return;
            }

            // Skip messages the user sends TO OTHER CONTACTS.
            // Only process fromMe messages that are in a self-chat (user messaging themselves).
            // This prevents the bot from replying inside the user's chats with friends/family.
            if (msg.key.fromMe && !isSelfChat) {
                const recipientNumber = senderJid.split('@')[0].split(':')[0];
                if (userNumber && recipientNumber !== userNumber) {
                    return;
                }
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

            // Auto-link phone to email if user completed Google OAuth
            let isRegistered = false;
            try {
                const existingUser = await this.userManager.getUserByPhone(userNumber);
                if (existingUser && existingUser.registration_status === 'completed') {
                    isRegistered = true;
                } else if (!existingUser && sessionId.includes('@')) {
                    // Phone not linked yet — try to link to the email (sessionId)
                    const userByEmail = await this.userManager.getUserByEmail(sessionId);
                    if (userByEmail && userByEmail.registration_status === 'completed') {
                        await this.userManager.linkPhoneNumberToEmail(sessionId, userNumber);
                        console.log(chalk.green(`[Session ${sessionId}] Auto-linked phone ${userNumber} to ${sessionId}`));
                        isRegistered = true;
                    }
                }
                await this.sessionCollection.updateOne(
                    { sessionId },
                    { $set: { googleConnected: isRegistered, lastActive: new Date() } }
                );
            } catch (autoRegErr: any) {
                console.error(chalk.red(`[Session ${sessionId}] Auto-register error: ${autoRegErr.message}`));
            }

            // Process with AI agent
            try {
                const toolRegistry = new ToolRegistry();
                const agent = new AgentCore(this.nlpEngine, toolRegistry, this.memoryManager, this.userManager, this.sandboxManager);
                const incomingMessage = {
                    senderId: userNumber,
                    senderName: userNumber,
                    text,
                    timestamp: new Date(),
                    messageId: msg.key.id || '',
                    isGroup: senderJid.includes('@g.us'),
                };
                console.log(chalk.cyan(`[Session ${sessionId}] Processing with AI agent...`));

                // Keep typing indicator alive every 8s while agent processes
                let typingAlive = true;
                const typingInterval = setInterval(async () => {
                    if (!typingAlive) return;
                    try { await sock.sendPresenceUpdate('composing', replyJid); } catch { /* ignore */ }
                }, 8000);

                let response: string;
                try {
                    await sock.sendPresenceUpdate('composing', replyJid);
                    response = await agent.handleMessage(incomingMessage, userNumber);
                } finally {
                    typingAlive = false;
                    clearInterval(typingInterval);
                    try { await sock.sendPresenceUpdate('paused', replyJid); } catch { /* ignore */ }
                }

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
        const handleDecryptError = async (error: Error) => {
            const errName = error?.name || '';
            const errMsg = error?.message || '';

            const isDecryptError =
                errName === 'PreKeyError' ||
                errName === 'SessionError' ||
                errMsg.includes('Invalid PreKey ID') ||
                errMsg.includes('failed to decrypt') ||
                errMsg.includes('No matching sessions') ||
                errMsg.includes('Bad MAC');

            if (!isDecryptError) return;

            const count = (this.decryptErrorCounts.get(sessionId) || 0) + 1;
            this.decryptErrorCounts.set(sessionId, count);

            // Suppress noisy repeated logs — only log every 5th error
            if (count % 5 === 1) {
                console.log(chalk.gray(`[Session ${sessionId}] Decryption error #${count} (${errName}): ${errMsg.substring(0, 80)}`));
            }

            if (count >= SessionManager.MAX_DECRYPT_ERRORS) {
                console.log(chalk.yellow(`[Session ${sessionId}] Too many decryption errors (${count}). Resetting session...`));

                // Clear all session auth data — Bad MAC means keys are fully corrupted
                await this.db.collection('baileys_auth').deleteMany({ sessionId });
                this.sessions.delete(sessionId);
                this.decryptErrorCounts.set(sessionId, 0);

                // End the socket to force a clean re-pair with new QR code
                try { sock.end(undefined); } catch { /* already closed */ }

                console.log(chalk.green(`[Session ${sessionId}] Session auth cleared. User will need to scan QR code again.`));
            }
        };

        // Catch unhandled promise rejections from libsignal/Baileys decryption
        const rejectionHandler = (reason: any) => {
            if (reason instanceof Error) {
                handleDecryptError(reason).catch(() => { });
            }
        };
        process.on('unhandledRejection', rejectionHandler);

        // Also listen for Baileys' own error logging via a custom pino destination
        // Baileys logs "Session error" via its logger — catch via socket ws error event
        sock.ws?.on('error', (err: Error) => {
            handleDecryptError(err).catch(() => { });
        });

        // Clean up handler when socket closes to prevent listener leaks
        sock.ev.on('connection.update', (update: any) => {
            if (update.connection === 'close') {
                process.removeListener('unhandledRejection', rejectionHandler);
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
