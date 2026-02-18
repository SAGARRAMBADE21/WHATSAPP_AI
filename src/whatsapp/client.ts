import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    WASocket,
    proto,
    WAMessageContent,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import { config } from '../config';
import { IncomingMessage } from '../types';
import { AgentCore } from '../agent/core';
import { UserManager } from '../auth/user-manager';
import chalk from 'chalk';
import { URL } from 'url';
import qrcode from 'qrcode-terminal';

export class WhatsAppClient {
    private socket: WASocket | null = null;
    private agent: AgentCore;
    private userManager: UserManager;
    private logger: pino.Logger;
    private processingMessages: Set<string> = new Set();
    private sentMessageIds: Set<string> = new Set();

    constructor(agent: AgentCore, userManager: UserManager) {
        this.agent = agent;
        this.userManager = userManager;
        this.logger = pino({ level: config.logLevel });
    }

    async start(): Promise<void> {
        const authDir = config.whatsapp.authStatePath;
        if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();

        this.socket = makeWASocket({
            version,
            auth: state,
            logger: this.logger,
            printQRInTerminal: false,  // We'll handle QR display ourselves
            browser: ['Workspace Navigator', 'Chrome', '120.0'],
            generateHighQualityLinkPreview: false,
        });

        // Handle connection updates
        this.socket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(chalk.cyan('\n   ┌─────────────────────────────────────────────────┐'));
                console.log(chalk.cyan('   │') + chalk.bold(' 📱 WhatsApp QR Code                           ') + chalk.cyan('│'));
                console.log(chalk.cyan('   └─────────────────────────────────────────────────┘\n'));
                console.log(chalk.gray('   Scan this QR code with WhatsApp on your phone:\n'));

                qrcode.generate(qr, { small: true });

                console.log(chalk.bold('\n   💡 How to scan:'));
                console.log(chalk.gray('      1. Open WhatsApp on your phone'));
                console.log(chalk.gray('      2. Tap Menu (⋮) → Linked Devices'));
                console.log(chalk.gray('      3. Tap "Link a Device"'));
                console.log(chalk.gray('      4. Scan the QR code above\n'));
            }

            if (connection === 'close') {
                const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = reason !== DisconnectReason.loggedOut;
                console.log(chalk.yellow(`\n   ⚠  WhatsApp disconnected. Reason: ${reason}`));
                if (shouldReconnect) {
                    console.log(chalk.cyan('   🔄 Reconnecting in 3 seconds...\n'));
                    setTimeout(() => this.start(), 3000);
                } else {
                    console.log(chalk.red('   ✖ Logged out. Delete auth_state folder and restart to re-link.\n'));
                }
            }

            if (connection === 'open') {
                console.log(chalk.bold.green('\n╔═══════════════════════════════════════════════════╗'));
                console.log(chalk.bold.green('║') + chalk.bold.white('   ✓ WORKSPACE NAVIGATOR IS RUNNING                ') + chalk.bold.green('║'));
                console.log(chalk.bold.green('╚═══════════════════════════════════════════════════╝'));
                console.log(chalk.gray('\n   Listening for WhatsApp messages...'));
                console.log(chalk.gray('   Press Ctrl+C to stop\n'));
            }
        });

        // Save credentials on update
        this.socket.ev.on('creds.update', saveCreds);

        // Handle incoming messages
        this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                await this.handleIncomingMessage(msg);
            }
        });
    }

    private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
        // Skip if no message content
        if (!msg.message) return;

        // Skip status broadcasts
        if (msg.key.remoteJid === 'status@broadcast') return;

        // Skip messages sent by this bot (tracked by message ID)
        const messageId = msg.key.id || '';
        if (this.sentMessageIds.has(messageId)) {
            console.log(chalk.gray('[WhatsApp] Skipping bot-sent message'));
            return;
        }

        // Simplified logging for privacy
        const jid = msg.key.remoteJid || '';
        const isGroup = jid.endsWith('@g.us');
        const isSelfChat = jid.endsWith('@lid');

        // Skip if we're already processing this message
        if (this.processingMessages.has(messageId)) return;
        this.processingMessages.add(messageId);

        try {
            const jid = msg.key.remoteJid || '';
            const isGroup = jid.endsWith('@g.us');
            const senderId = isGroup ? (msg.key.participant || jid) : jid;

            // Extract phone number - handle linked devices (@lid)
            let phoneNumber: string;
            if (isSelfChat && config.whatsapp.ownerNumber) {
                // For self-chat/linked devices, use owner number from config
                phoneNumber = config.whatsapp.ownerNumber;
                console.log(chalk.yellow(`[DEBUG] Linked device detected, using owner number: ${phoneNumber}`));
            } else {
                // For regular messages, extract from JID
                phoneNumber = senderId.split('@')[0].split(':')[0];
                console.log(chalk.yellow(`[DEBUG] Sender phone number: ${phoneNumber}`));
            }

            // Construct proper target JID for sending messages
            // For linked devices, send to phone number directly, not the @lid JID
            const targetJid = isSelfChat ? `${phoneNumber}@s.whatsapp.net` : jid;
            console.log(chalk.cyan(`[DEBUG] Target JID for replies: ${targetJid}`));

            // Allow all users to interact (removed allowed numbers check)
            if (config.whatsapp.allowedNumbers.length > 0) {
                // only log warning but don't block
                if (!config.whatsapp.allowedNumbers.includes(phoneNumber)) {
                    console.log(chalk.yellow(`[WhatsApp] Message from non-listed number: ${phoneNumber} (Allowed: ${config.whatsapp.allowedNumbers.join(',')})`));
                    // We continue processing so they can register
                }
            }

            // Extract text content
            const text = this.extractTextContent(msg.message);
            console.log(chalk.yellow(`[DEBUG] Extracted text: "${text}"`));
            if (!text) {
                console.log(chalk.red(`[DEBUG] No text content found, skipping message`));
                return;
            }

            // Skip very short or non-command messages in groups
            if (isGroup && !text.toLowerCase().startsWith('@nav') && !text.toLowerCase().startsWith('!nav')) {
                console.log(chalk.red(`[DEBUG] Group message without @nav prefix, skipping`));
                return; // In groups, require a trigger prefix
            }

            const cleanText = isGroup
                ? text.replace(/^@nav\s*/i, '').replace(/^!nav\s*/i, '').trim()
                : text.trim();

            if (!cleanText) return;

            const senderName = msg.pushName || phoneNumber;

            console.log(`[WhatsApp] Message from ${senderName}: "${cleanText}"`);

            // Handle special commands
            // Handle special commands
            if (cleanText.toLowerCase().startsWith('/register')) {
                console.log(chalk.magenta(`[DEBUG] Handling /register command for ${phoneNumber}`));
                try {
                    console.log(chalk.magenta(`[DEBUG] Calling userManager.startRegistration...`));
                    const authUrl = await this.userManager.startRegistration(phoneNumber);

                    // Print the full URL to console for easy copying
                    console.log(chalk.bold.cyan('\n════════════════════════════════════════════════════════════'));
                    console.log(chalk.bold.green('📱 GOOGLE AUTHORIZATION LINK'));
                    console.log(chalk.bold.cyan('════════════════════════════════════════════════════════════'));
                    console.log(chalk.bold.white('\n👉 Open this link IN YOUR COMPUTER BROWSER (not on phone):'));
                    console.log(chalk.bold.yellow(`\n${authUrl}\n`));
                    console.log(chalk.gray('   (Link also sent to WhatsApp)'));
                    console.log(chalk.bold.cyan('════════════════════════════════════════════════════════════\n'));

                    const response = `🔐 *Connect Your Google Workspace*\n\n` +
                        `Click this link to authorize:\n${authUrl}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `📌 *Option 1 (Recommended):*\n` +
                        `Open this link on your *COMPUTER* browser.\n` +
                        `It will complete automatically.\n\n` +
                        `📌 *Option 2 (From Phone):*\n` +
                        `1. Open the link above\n` +
                        `2. Sign in with Google\n` +
                        `3. After "This site can't be reached" page appears\n` +
                        `4. Copy the URL from your browser address bar\n` +
                        `5. Send it here: /code PASTE_URL_HERE\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `⏰ Link expires in 30 minutes`;

                    console.log(chalk.magenta(`[DEBUG] Sending response to ${targetJid}...`));
                    const result = await this.socket?.sendMessage(targetJid, { text: response });
                    if (result?.key?.id) this.sentMessageIds.add(result.key.id);
                    console.log(chalk.green(`[DEBUG] /register response sent!`));
                    return;
                } catch (error: any) {
                    console.error(chalk.red(`[DEBUG] Registration error:`), error);
                    const errResult = await this.socket?.sendMessage(targetJid, {
                        text: `❌ Registration error: ${error.message}\n\nPlease try again or contact support.`
                    });
                    if (errResult?.key?.id) this.sentMessageIds.add(errResult.key.id);
                    return;
                }
            }

            // Handle /code command - for phone users who can't reach localhost
            if (cleanText.toLowerCase().startsWith('/code')) {
                console.log(chalk.magenta(`[DEBUG] Handling /code command for ${phoneNumber}`));
                try {
                    let codeValue = cleanText.substring(5).trim();

                    // If user pasted the full URL, extract the code parameter
                    if (codeValue.includes('code=')) {
                        try {
                            // Handle both full URLs and partial URLs
                            let urlStr = codeValue;
                            if (!urlStr.startsWith('http')) {
                                urlStr = 'http://localhost' + (urlStr.startsWith('/') ? '' : '/') + urlStr;
                            }
                            const parsedUrl = new URL(urlStr);
                            codeValue = parsedUrl.searchParams.get('code') || codeValue;
                        } catch {
                            // If URL parsing fails, try regex extraction
                            const match = codeValue.match(/code=([^&\s]+)/);
                            if (match) codeValue = match[1];
                        }
                    }

                    if (!codeValue) {
                        const errMsg = `❌ Please provide the authorization code.\n\n` +
                            `Usage: /code PASTE_URL_OR_CODE_HERE\n\n` +
                            `After signing in with Google, copy the full URL from your browser and paste it here.`;
                        const errResult = await this.socket?.sendMessage(targetJid, { text: errMsg });
                        if (errResult?.key?.id) this.sentMessageIds.add(errResult.key.id);
                        return;
                    }

                    console.log(chalk.cyan(`[OAuth] Processing code from WhatsApp for ${phoneNumber}: ${codeValue.substring(0, 15)}...`));

                    // Exchange code for tokens
                    const success = await this.userManager.completeRegistrationWithCode(phoneNumber, codeValue);

                    if (success) {
                        const successMsg = `✅ *Registration Complete!*\n\n` +
                            `Your Google Workspace is now connected.\n\n` +
                            `You can now:\n` +
                            `📧 Manage Gmail\n` +
                            `📅 Control Calendar\n` +
                            `📁 Access Drive\n` +
                            `📊 Work with Sheets\n` +
                            `📄 Edit Docs\n\n` +
                            `Send any message to get started!`;
                        const successResult = await this.socket?.sendMessage(targetJid, { text: successMsg });
                        if (successResult?.key?.id) this.sentMessageIds.add(successResult.key.id);
                    } else {
                        const failMsg = `❌ Registration failed. The code may be expired.\n\n` +
                            `Please send /register to get a new link and try again.`;
                        const failResult = await this.socket?.sendMessage(targetJid, { text: failMsg });
                        if (failResult?.key?.id) this.sentMessageIds.add(failResult.key.id);
                    }
                    return;
                } catch (error: any) {
                    console.error(chalk.red(`[DEBUG] Code exchange error:`), error);
                    const errResult = await this.socket?.sendMessage(targetJid, {
                        text: `❌ Error processing code: ${error.message}\n\nPlease send /register to get a new link.`
                    });
                    if (errResult?.key?.id) this.sentMessageIds.add(errResult.key.id);
                    return;
                }
            }

            if (cleanText.toLowerCase().startsWith('/logout')) {
                const success = await this.userManager.revokeUser(phoneNumber);
                const response = success
                    ? `✅ **Access Revoked**\n\nAll your data has been deleted.\nSend /register to reconnect.`
                    : `❌ Failed to revoke access. Please try again.`;
                const logoutResult = await this.socket?.sendMessage(targetJid, { text: response });
                if (logoutResult?.key?.id) this.sentMessageIds.add(logoutResult.key.id);
                return;
            }

            if (cleanText.toLowerCase().startsWith('/status')) {
                const isRegistered = await this.userManager.isUserRegistered(phoneNumber);
                const user = await this.userManager.getUser(phoneNumber);
                const response = isRegistered && user
                    ? `✅ **Registered**\n\n` +
                    `📧 Email: ${user.email}\n` +
                    `👤 Name: ${user.name}\n` +
                    `📅 Registered: ${new Date(user.created_at).toLocaleDateString()}\n` +
                    `🕐 Last Active: ${new Date(user.last_active).toLocaleString()}`
                    : `⚠️ **Not Registered**\n\nSend /register to get started!`;
                const statusResult = await this.socket?.sendMessage(targetJid, { text: response });
                if (statusResult?.key?.id) this.sentMessageIds.add(statusResult.key.id);
                return;
            }

            // Show typing indicator
            await this.socket?.presenceSubscribe(jid);
            await this.socket?.sendPresenceUpdate('composing', jid);

            // Process message through agent (with phone number for multi-user)
            const incomingMessage: IncomingMessage = {
                senderId: phoneNumber,
                senderName,
                text: cleanText,
                timestamp: new Date((msg.messageTimestamp as number) * 1000 || Date.now()),
                isGroup,
                groupId: isGroup ? jid : undefined,
                messageId,
            };

            // Start check for registration status
            const isRegistered = await this.userManager.isUserRegistered(phoneNumber);
            if (!isRegistered) {
                // If not registered, send helpful registration prompt
                console.log(chalk.gray(`[WhatsApp] Message from unregistered user: ${phoneNumber}, sending registration prompt`));
                console.log(chalk.yellow(`[DEBUG] JID: ${jid}, isSelfChat: ${isSelfChat}, isGroup: ${isGroup}`));

                // Send typing indicator
                await this.socket?.sendPresenceUpdate('composing', jid);

                const welcomeMessage = `👋 Welcome to Workspace Navigator!\n\n` +
                    `🤖 I'm your AI assistant for Google Workspace\n\n` +
                    `To get started, you need to connect your Google account:\n` +
                    `📝 Send: /register\n\n` +
                    `Once connected, you can:\n` +
                    `📧 Manage Gmail\n` +
                    `📅 Control Calendar\n` +
                    `📁 Access Drive\n` +
                    `📊 Work with Sheets\n` +
                    `📄 Edit Docs\n` +
                    `🎓 Manage Classroom\n\n` +
                    `All through natural language commands!`;

                try {
                    console.log(chalk.magenta(`[DEBUG] Attempting to send to JID: ${targetJid}`));
                    console.log(chalk.magenta(`[DEBUG] Socket exists: ${!!this.socket}`));

                    await this.socket?.sendPresenceUpdate('paused', targetJid);
                    const result = await this.socket?.sendMessage(targetJid, { text: welcomeMessage });

                    // Track sent message ID
                    if (result?.key?.id) {
                        this.sentMessageIds.add(result.key.id);
                    }

                    console.log(chalk.green(`[WhatsApp] ✓ Welcome message sent to ${phoneNumber}`));
                    console.log(chalk.magenta(`[DEBUG] Send result:`, JSON.stringify(result, null, 2)));
                } catch (error) {
                    console.error(chalk.red(`[WhatsApp] ✖ Failed to send welcome message:`), error);
                }
                return;
            }

            console.log(chalk.cyan(`[DEBUG] Calling agent.handleMessage...`));
            let response: string;
            try {
                // We don't need to pass phoneNumber again since it's in incomingMessage
                response = await this.agent.handleMessage(incomingMessage, phoneNumber);

                // If agent returns nothing (e.g. ignored), don't send anything
                if (!response) return;

                console.log(chalk.green(`[DEBUG] Agent returned response`));
            } catch (agentError) {
                console.error(chalk.red(`[WhatsApp] ❌ Error from agent:`), agentError);
                throw agentError;
            }

            console.log(chalk.cyan(`[DEBUG] About to send response to WhatsApp...`));

            try {
                // Send response
                await this.socket?.sendPresenceUpdate('paused', jid);
                console.log(chalk.cyan(`[DEBUG] Presence updated`));

                console.log(chalk.cyan(`[WhatsApp] Sending response to ${jid}...`));

                // Always send back to the original JID
                const targetJid = jid;

                // Split long messages (WhatsApp has a ~65000 char limit, but shorter is better)
                const chunks = this.splitMessage(response, 4000);
                console.log(chalk.cyan(`[WhatsApp] Message split into ${chunks.length} chunk(s)`));

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    console.log(chalk.cyan(`[WhatsApp] Sending chunk ${i + 1}/${chunks.length}: "${chunk.substring(0, 50)}..."`));

                    try {
                        // For self-chat, send without quoted message to avoid fromMe issues
                        const sentMsg = await this.socket?.sendMessage(
                            targetJid,
                            { text: chunk },
                            isSelfChat ? undefined : { quoted: msg }
                        );
                        if (sentMsg?.key?.id) this.sentMessageIds.add(sentMsg.key.id);
                        console.log(chalk.green(`[WhatsApp] ✓ Chunk ${i + 1} sent successfully to ${targetJid}`));
                    } catch (sendError) {
                        console.error(chalk.red(`[WhatsApp] ❌ Error sending chunk ${i + 1}:`), sendError);
                        // Try sending without quoted message
                        console.log(chalk.yellow(`[WhatsApp] Retrying without quote...`));
                        const retryMsg = await this.socket?.sendMessage(targetJid, { text: chunk });
                        if (retryMsg?.key?.id) this.sentMessageIds.add(retryMsg.key.id);
                        console.log(chalk.green(`[WhatsApp] ✓ Chunk ${i + 1} sent without quote`));
                    }

                    if (chunks.length > 1 && i < chunks.length - 1) {
                        await new Promise((r) => setTimeout(r, 500)); // Small delay between chunks  
                    }
                }
                console.log(chalk.bold.green(`[WhatsApp] ✓ All messages sent to ${senderName}`));
            } catch (error) {
                console.error(chalk.red(`[WhatsApp] ❌ Error in send block:`), error);
                throw error;
            }
        } catch (error: any) {
            console.error('[WhatsApp] Error handling message:', error);
            const jidForError = msg.key.remoteJid || '';
            const isSelfChatError = jidForError.endsWith('@lid');
            const targetJidForError = isSelfChatError && config.whatsapp.ownerNumber
                ? `${config.whatsapp.ownerNumber}@s.whatsapp.net`
                : jidForError;
            await this.socket?.sendMessage(targetJidForError, {
                text: '⚠️ Sorry, I encountered an error processing your request. Please try again.',
            });
        } finally {
            // Clean up processing set after a delay
            setTimeout(() => this.processingMessages.delete(messageId), 60000);
        }
    }

    private extractTextContent(message: WAMessageContent | null | undefined): string | null {
        if (!message) return null;

        // Handle ephemeral messages (disappearing messages)
        if (message.ephemeralMessage?.message) {
            return this.extractTextContent(message.ephemeralMessage.message);
        }

        // Handle view once messages
        if (message.viewOnceMessage?.message) {
            return this.extractTextContent(message.viewOnceMessage.message);
        }

        if (message.conversation) return message.conversation;
        if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
        if (message.imageMessage?.caption) return message.imageMessage.caption;
        if (message.videoMessage?.caption) return message.videoMessage.caption;
        if (message.documentMessage?.caption) return message.documentMessage.caption;

        return null;
    }

    private splitMessage(text: string, maxLength: number): string[] {
        if (text.length <= maxLength) return [text];

        const chunks: string[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                chunks.push(remaining);
                break;
            }

            // Find a good break point
            let breakPoint = remaining.lastIndexOf('\n', maxLength);
            if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
                breakPoint = remaining.lastIndexOf('. ', maxLength);
            }
            if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
                breakPoint = maxLength;
            }

            chunks.push(remaining.substring(0, breakPoint + 1));
            remaining = remaining.substring(breakPoint + 1);
        }

        return chunks;
    }

    async sendMessage(jid: string, text: string): Promise<void> {
        await this.socket?.sendMessage(jid, { text });
    }
}