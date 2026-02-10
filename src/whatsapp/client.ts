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
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';

export class WhatsAppClient {
    private socket: WASocket | null = null;
    private agent: AgentCore;
    private logger: pino.Logger;
    private processingMessages: Set<string> = new Set();

    constructor(agent: AgentCore) {
        this.agent = agent;
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

        // DEBUG: Log all incoming messages
        const jid = msg.key.remoteJid || '';
        const isGroup = jid.endsWith('@g.us');
        const isSelfChat = jid.endsWith('@lid');
        
        console.log(chalk.yellow(`\n[DEBUG] Received message from: ${jid}`));
        console.log(chalk.yellow(`[DEBUG] Is group: ${isGroup}`));
        console.log(chalk.yellow(`[DEBUG] Is self-chat: ${isSelfChat}`));
        console.log(chalk.yellow(`[DEBUG] fromMe: ${msg.key.fromMe}`));
        console.log(chalk.yellow(`[DEBUG] Message type: ${Object.keys(msg.message || {}).join(', ')}`));
        
        // Skip messages sent by us UNLESS it's in self-chat (@lid)
        if (msg.key.fromMe && !isSelfChat) {
            console.log(chalk.red(`[DEBUG] Skipping own message (not self-chat)`));
            return;
        }

        // Skip if we're already processing this message
        const messageId = msg.key.id || '';
        if (this.processingMessages.has(messageId)) return;
        this.processingMessages.add(messageId);

        try {
            const jid = msg.key.remoteJid || '';
            const isGroup = jid.endsWith('@g.us');
            const senderId = isGroup ? (msg.key.participant || jid) : jid;

            // Extract phone number
            const phoneNumber = senderId.split('@')[0].split(':')[0];

            console.log(chalk.yellow(`[DEBUG] Sender phone number: ${phoneNumber}`));
            console.log(chalk.yellow(`[DEBUG] Allowed numbers: ${JSON.stringify(config.whatsapp.allowedNumbers)}`));
            console.log(chalk.yellow(`[DEBUG] Allowed numbers length: ${config.whatsapp.allowedNumbers.length}`));

            // Check if sender is allowed
            if (config.whatsapp.allowedNumbers.length > 0) {
                if (!config.whatsapp.allowedNumbers.includes(phoneNumber)) {
                    console.log(chalk.red(`[WhatsApp] Ignored message from unauthorized number: ${phoneNumber}`));
                    return;
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

            // Show typing indicator
            await this.socket?.presenceSubscribe(jid);
            await this.socket?.sendPresenceUpdate('composing', jid);

            // Process message through agent
            const incomingMessage: IncomingMessage = {
                senderId: phoneNumber,
                senderName,
                text: cleanText,
                timestamp: new Date((msg.messageTimestamp as number) * 1000 || Date.now()),
                isGroup,
                groupId: isGroup ? jid : undefined,
                messageId,
            };

            console.log(chalk.cyan(`[DEBUG] Calling agent.handleMessage...`));
            let response: string;
            try {
                response = await this.agent.handleMessage(incomingMessage);
                console.log(chalk.green(`[DEBUG] Agent returned response, length: ${response?.length || 0}`));
                console.log(chalk.green(`[WhatsApp] Agent response: "${response.substring(0, 100)}..."`));
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

                // For self-chat (@lid), send to the owner's actual phone number
                let targetJid = jid;
                if (isSelfChat) {
                    // Use the owner's phone number from config
                    targetJid = `${config.whatsapp.ownerNumber}@s.whatsapp.net`;
                    console.log(chalk.yellow(`[DEBUG] Self-chat detected, sending to owner ${targetJid} instead of ${jid}`));
                }

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
                        console.log(chalk.green(`[WhatsApp] ✓ Chunk ${i + 1} sent successfully to ${targetJid}`));
                    } catch (sendError) {
                        console.error(chalk.red(`[WhatsApp] ❌ Error sending chunk ${i + 1}:`), sendError);
                        // Try sending without quoted message
                        console.log(chalk.yellow(`[WhatsApp] Retrying without quote...`));
                        await this.socket?.sendMessage(targetJid, { text: chunk });
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
            const jid = msg.key.remoteJid || '';
            await this.socket?.sendMessage(jid, {
                text: '⚠️ Sorry, I encountered an error processing your request. Please try again.',
            });
        } finally {
            // Clean up processing set after a delay
            setTimeout(() => this.processingMessages.delete(messageId), 60000);
        }
    }

    private extractTextContent(message: WAMessageContent): string | null {
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